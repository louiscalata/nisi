// UI-less containing app. No generated input, filesystem work, or service kills.
#import "probe-wire.h"
#include <sys/resource.h>
@interface Terminal : NSObject
@property(nonatomic) NSTimeInterval deadline;
@property(nonatomic, strong) NSString *status;
@property(nonatomic, strong) NSData *data;
@property(nonatomic, strong) dispatch_semaphore_t ready;
- (void)finish:(NSString *)status data:(NSData *)data;
@end
@implementation Terminal
- (void)finish:(NSString *)status data:(NSData *)data {
    @synchronized(self) {
        if (_status) return;
        // Deadline checked after response copy too; copying cannot admit a late reply.
        NSData *copy = [data copy];
        if (NSProcessInfo.processInfo.systemUptime >= _deadline) { status = @"TIMEOUT"; copy = nil; }
        _status = status; _data = copy; dispatch_semaphore_signal(_ready);
    }
}
@end
int main(int argc, const char *argv[]) {
    (void)argv; if (argc != 1) return 64;
    @autoreleasepool {
        struct rlimit cpu = {3, 3}, core = {0, 0};
        if (setrlimit(RLIMIT_CPU, &cpu) != 0 || setrlimit(RLIMIT_CORE, &core) != 0) return 65;
        NSString *home = NSHomeDirectory();
        if (![home isEqualToString:NISI_CLIENT_HOME]) return 66;
        Terminal *terminal = [Terminal new];
        terminal.ready = dispatch_semaphore_create(0);
        terminal.deadline = NSProcessInfo.processInfo.systemUptime + 5.0;
        NSXPCConnection *connection = [[NSXPCConnection alloc] initWithServiceName:NISI_SERVICE_ID];
        connection.remoteObjectInterface = [NSXPCInterface interfaceWithProtocol:@protocol(NisiFixedProbe)];
        connection.interruptionHandler = ^{ [terminal finish:@"INTERRUPTED" data:nil]; };
        connection.invalidationHandler = ^{ [terminal finish:@"INVALIDATED" data:nil]; };
        [connection activate];
        id<NisiFixedProbe> proxy = [connection remoteObjectProxyWithErrorHandler:^(NSError *error) {
            (void)error; [terminal finish:@"PROXY_ERROR" data:nil];
        }];
        NSData *request = requestFrame(getpid());
#if NISI_PROBE_CASE == 1
        // Compiled fixed adverse case; never request-controlled behavior.
        NSMutableData *malformed = [request mutableCopy];
        ((uint8_t *)malformed.mutableBytes)[0] ^= 1;
        request = [malformed copy];
#endif
        [proxy probe:request reply:^(NSData *response) {
            // Reject oversize before copying/decoding; NSData allocation is still NSXPC-owned.
            if (![response isKindOfClass:NSData.class] || response.length > 1145) {
                [terminal finish:@"MALFORMED" data:nil]; return;
            }
            [terminal finish:@"REPLY_RECEIVED" data:response];
        }];
        if (dispatch_semaphore_wait(terminal.ready, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC)) != 0)
            [terminal finish:@"TIMEOUT" data:nil];
        [connection invalidate];
        NSString *status; NSData *response;
        @synchronized(terminal) { status = terminal.status; response = terminal.data; }
        if ([status isEqualToString:@"REPLY_RECEIVED"] && !validReplyShape(response, getpid())) status = @"MALFORMED";
        if ([status isEqualToString:@"REPLY_RECEIVED"] && NSProcessInfo.processInfo.systemUptime >= terminal.deadline) status = @"TIMEOUT";
        if (![status isEqualToString:@"REPLY_RECEIVED"]) response = nil;
        NSDictionary *record = @{ @"schemaVersion": @"nisi-fixed-xpc-client-v1", @"runId": NISI_RUN_ID,
            @"pid": @(getpid()), @"home": home, @"status": status ?: @"INCONCLUSIVE",
            @"replyBase64": response ? [response base64EncodedStringWithOptions:0] : @"", @"authorizing": @NO };
        NSError *error = nil;
        NSData *json = [NSJSONSerialization dataWithJSONObject:record options:NSJSONWritingSortedKeys | NSJSONWritingWithoutEscapingSlashes error:&error];
        if (error || !json || fwrite(json.bytes, 1, json.length, stdout) != json.length || fputc('\n', stdout) == EOF || fflush(stdout) != 0) return 67;
        return [status isEqualToString:@"REPLY_RECEIVED"] ? 0 : 70;
    }
}
