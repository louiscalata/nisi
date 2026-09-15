// PRIVATE FIXED engineering protocol. No task, path, command, or candidate input.
#import <Foundation/Foundation.h>
#include <unistd.h>
#include <stdint.h>
#include <string.h>
#include "probe-config.h"
#if !defined(NISI_PROBE_CASE) || NISI_PROBE_CASE < 0 || NISI_PROBE_CASE > 2
#error fixed fixture case must be 0 (valid), 1 (malformed request), or 2 (no reply)
#endif
@protocol NisiFixedProbe
- (void)probe:(NSData *)request reply:(void (^)(NSData *))reply;
@end
static inline void append32(NSMutableData *data, uint32_t value) {
    uint8_t b[] = {value >> 24, value >> 16, value >> 8, value};
    [data appendBytes:b length:4];
}
static inline uint32_t read32(const uint8_t *p) {
    return ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) | ((uint32_t)p[2] << 8) | p[3];
}
static inline NSData *requestFrame(pid_t pid) {
    NSMutableData *data = [NSMutableData dataWithBytes:"NRQ1" length:4];
    [data appendData:[NISI_RUN_ID dataUsingEncoding:NSASCIIStringEncoding]];
    append32(data, (uint32_t)pid);
    return [data copy];
}
static inline BOOL validRequest(NSData *data, pid_t peer) {
    return peer > 0 && [data isKindOfClass:NSData.class] && data.length == 40 &&
        [data isEqualToData:requestFrame(peer)];
}
static inline BOOL validReplyShape(NSData *data, pid_t client) {
    if (![data isKindOfClass:NSData.class] || data.length < 121 || data.length > 1145) return NO;
    const uint8_t *p = data.bytes;
    if (memcmp(p, "NRS1", 4) || memcmp(p + 4, NISI_RUN_ID.UTF8String, 32) ||
        client <= 0 || read32(p + 36) != (uint32_t)client || read32(p + 40) == 0 ||
        read32(p + 40) > INT32_MAX || read32(p + 40) == (uint32_t)client) return NO;
    NSUInteger size = ((NSUInteger)p[44] << 8) | p[45];
    if (size == 0 || size > 1024 || data.length != 121 + size) return NO;
    NSData *homeBytes = [data subdataWithRange:NSMakeRange(46, size)];
    NSString *home = [[NSString alloc] initWithData:homeBytes encoding:NSUTF8StringEncoding];
    if (![home isEqualToString:NISI_SERVICE_HOME]) return NO;
    // Outcomes are fixture labels; the outer closed reader adjudicates semantics.
    for (NSUInteger i = 46 + size; i < data.length; i += 5) {
        uint8_t status = p[i]; uint32_t code = read32(p + i + 1);
        if (status > 3 || code > INT32_MAX || ((status == 0 || status == 1) && code != 0) ||
            (status == 2 && code != 1 && code != 13)) return NO;
    }
    return YES;
}
