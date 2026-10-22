#pragma once
#include <stdint.h>
int ARGBBlend(const uint8_t*, int, const uint8_t*, int, uint8_t*, int, int, int);
int ARGBExtractAlpha(const uint8_t*, int, uint8_t*, int, int, int);
int BlendPlane(const uint8_t*, int, const uint8_t*, int, const uint8_t*, int, uint8_t*, int, int, int);
