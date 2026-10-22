#include "unicapture.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

static unicapture_state_t capture;
static struct {
    pthread_mutex_t lock;
    pthread_cond_t cond;
    pthread_t owner;
    const char* mode;
    int known, starts, waits, acquired, callbacks, released, terminated;
    int lease, violations, entered, allow, joining, self_result;
    uint8_t buffer[6];
} test={.lock=PTHREAD_MUTEX_INITIALIZER,.cond=PTHREAD_COND_INITIALIZER};

/* Observe that the real stop has reached its join, after requesting shutdown. */
int test_join(pthread_t thread, void** result)
{
    pthread_mutex_lock(&test.lock);
    if (test.known && !pthread_equal(test.owner,pthread_self())) {
        test.joining=1;pthread_cond_broadcast(&test.cond);
    }
    pthread_mutex_unlock(&test.lock);
    return pthread_join(thread,result);
}
static void owner(void)
{ if (!test.known || !pthread_equal(test.owner,pthread_self())) test.violations++; }
static int start(void* unused)
{
    (void)unused;pthread_mutex_lock(&test.lock);
    if (!test.known) {test.owner=pthread_self();test.known=1;} else owner();
    if (test.lease) test.violations++;
    test.starts++;memset(test.buffer,0x5a,sizeof(test.buffer));
    pthread_cond_broadcast(&test.cond);pthread_mutex_unlock(&test.lock);return 0;
}
static int wait_frame(void* unused)
{
    (void)unused;pthread_mutex_lock(&test.lock);owner();test.waits++;
    if (!strcmp(test.mode,"wait-stop")||!strcmp(test.mode,"metrics")) {
        test.entered=1;pthread_cond_broadcast(&test.cond);
        while (!test.allow) pthread_cond_wait(&test.cond,&test.lock);
    }
    int restart=!strcmp(test.mode,"restart") && test.waits==2;
    pthread_cond_broadcast(&test.cond);pthread_mutex_unlock(&test.lock);return restart?-99:0;
}
static int acquire(void* unused,frame_info_t* frame)
{
    (void)unused;pthread_mutex_lock(&test.lock);owner();
    if (!strcmp(test.mode,"invalid")||!strcmp(test.mode,"invalid-nv12")) {pthread_mutex_unlock(&test.lock);return -1;}
    test.acquired++;test.lease=1;
    frame->pixel_format=PIXFMT_ARGB;frame->width=1;frame->height=1;
    frame->planes[0].buffer=test.buffer;frame->planes[0].stride=4;
    if (!strcmp(test.mode,"nv12")) {
        frame->pixel_format=PIXFMT_YUV420_SEMI_PLANAR;frame->width=2;frame->height=2;
        frame->planes[0].stride=2;frame->planes[1].buffer=test.buffer+4;frame->planes[1].stride=2;
    }
    pthread_mutex_unlock(&test.lock);return 0;
}
static int consume(void* unused,int width,int height,uint8_t* buffer)
{
    (void)unused;pthread_mutex_lock(&test.lock);owner();test.callbacks++;
    int size=!strcmp(test.mode,"nv12")?2:1;
    if (width!=size||height!=size||buffer!=test.buffer||!test.lease||buffer[0]!=0x5a) test.violations++;
    if (!strcmp(test.mode,"callback-stop")) {
        test.entered=1;pthread_cond_broadcast(&test.cond);
        while (!test.allow) pthread_cond_wait(&test.cond,&test.lock);
    }
    pthread_mutex_unlock(&test.lock);
    if (!strcmp(test.mode,"self-stop")) {
        int result=unicapture_stop(&capture);
        pthread_mutex_lock(&test.lock);if(test.self_result==999)test.self_result=result;pthread_mutex_unlock(&test.lock);
    }
    pthread_mutex_lock(&test.lock);pthread_cond_broadcast(&test.cond);pthread_mutex_unlock(&test.lock);
    return 0;
}
static int consume_nv12(void* unused,int width,int height,uint8_t* y,uint8_t* uv,int stride_y,int stride_uv)
{
    assert(uv==test.buffer+4&&stride_y==2&&stride_uv==2);
    return consume(unused,width,height,y);
}
static int release(void* unused,frame_info_t* frame)
{
    (void)unused;(void)frame;pthread_mutex_lock(&test.lock);owner();
    if (!test.lease) test.violations++;
    test.lease=0;test.released++;pthread_cond_broadcast(&test.cond);pthread_mutex_unlock(&test.lock);return 0;
}
static int terminate(void* unused)
{
    (void)unused;pthread_mutex_lock(&test.lock);owner();
    if (test.lease) test.violations++;
    test.terminated++;memset(test.buffer,0xee,sizeof(test.buffer));
    pthread_cond_broadcast(&test.cond);pthread_mutex_unlock(&test.lock);return 0;
}
static void* stop(void* unused)
{ (void)unused;assert(unicapture_stop(&capture)==0);return NULL; }

int main(int argc,char** argv)
{
    assert(argc==2);alarm(6);test.mode=argv[1];test.self_result=999;
    capture_backend_t backend={.start=start,.wait=wait_frame,.acquire_frame=acquire,.release_frame=release,.terminate=terminate};
    unicapture_init(&capture);capture.video_capture=&backend;capture.target_format=PIXFMT_ARGB;
    capture.callback=consume;capture.fps=1000;capture.vsync=strcmp(test.mode,"vsync-disabled")!=0;
    if (!strcmp(test.mode,"nv12")||!strcmp(test.mode,"invalid-nv12")) {
        capture.target_format=PIXFMT_YUV420_SEMI_PLANAR;capture.callback=NULL;capture.callback_nv12=consume_nv12;
    }
    if (!strcmp(test.mode,"metrics")) capture.metrics.framerate=123;
    assert(unicapture_start(&capture)==0);
    assert(unicapture_start(&capture)==1);
    pthread_mutex_lock(&test.lock);
    if (!strcmp(test.mode,"callback-stop")||!strcmp(test.mode,"wait-stop")||!strcmp(test.mode,"metrics")) {
        while (!test.entered) pthread_cond_wait(&test.cond,&test.lock);
        if (!strcmp(test.mode,"metrics")) {
            pthread_mutex_lock(&capture.state_lock);
            assert(capture.metrics.framerate==0);
            capture.metrics.framerate=123;
            pthread_mutex_unlock(&capture.state_lock);
        }
        pthread_t stopping;assert(pthread_create(&stopping,NULL,stop,NULL)==0);
        while (!test.joining) pthread_cond_wait(&test.cond,&test.lock);
        assert(test.terminated==0);
        /* A second producer must not start while the first is being joined. */
        pthread_mutex_unlock(&test.lock);
        assert(unicapture_start(&capture)==1);
        assert(unicapture_stop(&capture)==1);
        pthread_mutex_lock(&test.lock);test.allow=1;pthread_cond_broadcast(&test.cond);
        pthread_mutex_unlock(&test.lock);assert(pthread_join(stopping,NULL)==0);
    } else {
        while ((!strcmp(test.mode,"restart")&&(test.starts<2||test.released<2)) ||
               ((!strcmp(test.mode,"invalid")||!strcmp(test.mode,"invalid-nv12"))&&test.waits<3) ||
               (!strcmp(test.mode,"nv12")&&test.released<3) ||
               (!strcmp(test.mode,"vsync-disabled")&&test.released<3) ||
               (!strcmp(test.mode,"self-stop")&&test.self_result==999)) pthread_cond_wait(&test.cond,&test.lock);
        pthread_mutex_unlock(&test.lock);assert(unicapture_stop(&capture)==0);
    }
    assert(unicapture_stop(&capture)==1);
    assert(test.violations==0);assert(test.acquired==test.released);
    assert(test.starts==test.terminated);
    if (!strcmp(test.mode,"metrics")) assert(capture.metrics.framerate==0);
    if (!strcmp(test.mode,"wait-stop")||!strcmp(test.mode,"invalid")||!strcmp(test.mode,"invalid-nv12")) assert(test.callbacks==0);
    if (!strcmp(test.mode,"vsync-disabled")) assert(test.waits==0);
    if (!strcmp(test.mode,"self-stop")) assert(test.self_result==-1);
    printf("PASS: %s starts=%d waits=%d callbacks=%d releases=%d terminates=%d\n",test.mode,test.starts,test.waits,test.callbacks,test.released,test.terminated);
    return 0;
}
