#include "converter.h"
#include "log.h"
#include <assert.h>
#include <string.h>
#include <time.h>

void converter_init(converter_t* converter) { memset(converter, 0, sizeof(*converter)); }
int converter_release(converter_t* converter) { (void)converter; return 0; }
int converter_run(converter_t* converter, frame_info_t* input, frame_info_t* output, pixel_format_t format)
{
    (void)converter;
    assert(input->pixel_format == format);
    *output = *input;
    return 0;
}
uint64_t getticks_us(void)
{
    struct timespec now;
    clock_gettime(CLOCK_MONOTONIC, &now);
    return (uint64_t)now.tv_sec * 1000000 + now.tv_nsec / 1000;
}
void log_printf(LogLevel level, const char* module, const char* format, ...)
{ (void)level; (void)module; (void)format; }
int ARGBBlend(const uint8_t* a, int b, const uint8_t* c, int d, uint8_t* e, int f, int g, int h)
{ (void)a;(void)b;(void)c;(void)d;(void)e;(void)f;(void)g;(void)h;assert(0);return -1; }
int ARGBExtractAlpha(const uint8_t* a, int b, uint8_t* c, int d, int e, int f)
{ (void)a;(void)b;(void)c;(void)d;(void)e;(void)f;assert(0);return -1; }
int BlendPlane(const uint8_t* a, int b, const uint8_t* c, int d, const uint8_t* e, int f, uint8_t* g, int h, int i, int j)
{ (void)a;(void)b;(void)c;(void)d;(void)e;(void)f;(void)g;(void)h;(void)i;(void)j;assert(0);return -1; }
