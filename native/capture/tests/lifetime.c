#include "unicapture.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

/* Only the real capture translation unit is compiled with pthread wrapper macros.
 * Barriers observe the production loop's actual wait/signal protocol. */
static struct {
    pthread_mutex_t lock;
    pthread_cond_t cond;
    pthread_t producer;
    int producer_known, producer_waiting, consuming, invalidated, waiter_yielded, waiter_waiting;
    int wait_calls, callbacks, released, terminated, violations, completed;
    unsigned char buffer[4];
} test = {.lock=PTHREAD_MUTEX_INITIALIZER, .cond=PTHREAD_COND_INITIALIZER};

int test_cond_wait(pthread_cond_t* cond, pthread_mutex_t* lock)
{
    pthread_mutex_lock(&test.lock);
    if (test.producer_known && pthread_equal(test.producer, pthread_self())) {
        test.producer_waiting = 1;
    } else {
        test.waiter_waiting = 1;
        if (test.consuming) test.waiter_yielded = 1;
    }
    pthread_cond_broadcast(&test.cond);
    pthread_mutex_unlock(&test.lock);
    int result=pthread_cond_wait(cond, lock);
    pthread_mutex_lock(&test.lock);
    if (!pthread_equal(test.producer,pthread_self())) test.waiter_waiting=0;
    pthread_mutex_unlock(&test.lock);
    return result;
}
int test_cond_signal(pthread_cond_t* cond) { return pthread_cond_signal(cond); }

static int start(void* unused)
{
    (void)unused;
    pthread_mutex_lock(&test.lock);
    test.producer=pthread_self();test.producer_known=1;
    memset(test.buffer, 0x5a, sizeof(test.buffer));
    test.invalidated=0;
    pthread_mutex_unlock(&test.lock);
    return 0;
}
static int wait_frame(void* unused)
{
    (void)unused;
    pthread_mutex_lock(&test.lock);
    int call=++test.wait_calls;
    if (test.producer_known && pthread_equal(test.producer,pthread_self())) {
        /* A single backend owner cannot invalidate its own callback in parallel. */
        test.waiter_yielded=1;
    } else if (call==1) {
        while (!test.producer_waiting) pthread_cond_wait(&test.cond,&test.lock);
    } else if (call==2) {
        while (!test.consuming && !test.completed) pthread_cond_wait(&test.cond,&test.lock);
    }
    pthread_mutex_unlock(&test.lock);
    return call==2 ? -99 : 0;
}
static int acquire(void* unused, frame_info_t* frame)
{
    (void)unused;
    frame->pixel_format=PIXFMT_ARGB;frame->width=1;frame->height=1;
    frame->planes[0].buffer=test.buffer;frame->planes[0].stride=4;
    return 0;
}
static int terminate(void* unused)
{
    (void)unused;
    pthread_mutex_lock(&test.lock);
    test.terminated++;
    if (test.consuming) test.violations++;
    test.invalidated=1;memset(test.buffer,0xee,sizeof(test.buffer));
    pthread_cond_broadcast(&test.cond);
    pthread_mutex_unlock(&test.lock);
    return 0;
}
static int release(void* unused, frame_info_t* frame)
{
    (void)unused;(void)frame;
    pthread_mutex_lock(&test.lock);test.released++;pthread_mutex_unlock(&test.lock);
    return 0;
}
static int consume(void* unused, int width, int height, uint8_t* bytes)
{
    (void)unused;assert(width==1&&height==1);
    pthread_mutex_lock(&test.lock);
    test.consuming=1;test.callbacks++;
    if (test.waiter_waiting) test.waiter_yielded=1;
    unsigned char original=bytes[0];
    pthread_cond_broadcast(&test.cond);
    /* The original thread terminates now. An ownership-aware waiter instead
     * sleeps until the current frame has been released. Both are observed. */
    while (!test.invalidated && !test.waiter_yielded) pthread_cond_wait(&test.cond,&test.lock);
    if (bytes[0]!=original || test.invalidated) test.violations++;
    test.consuming=0;test.completed=1;
    pthread_cond_broadcast(&test.cond);
    pthread_mutex_unlock(&test.lock);
    return 0;
}
int main(void)
{
    alarm(5);
    unicapture_state_t state;
    capture_backend_t backend={.start=start,.terminate=terminate,.wait=wait_frame,.acquire_frame=acquire,.release_frame=release};
    unicapture_init(&state);state.video_capture=&backend;state.target_format=PIXFMT_ARGB;
    state.callback=consume;state.fps=30;
    assert(unicapture_start(&state)==0);
    pthread_mutex_lock(&test.lock);
    while (!test.completed) pthread_cond_wait(&test.cond,&test.lock);
    pthread_mutex_unlock(&test.lock);
    assert(unicapture_stop(&state)==0);
    fprintf(stdout,"callbacks=%d releases=%d terminates=%d lifetime_violations=%d\n",test.callbacks,test.released,test.terminated,test.violations);
    if (!test.callbacks || !test.released || test.violations) {
        fputs("FAIL: backend invalidated a frame during consumption\n",stderr);return 1;
    }
    puts("PASS: frame remains valid through callback and release");
    return 0;
}
