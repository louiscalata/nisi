// Fixed native fixture only; launchd owns this service's lifecycle.
#import "probe-wire.h"
#include <sys/resource.h>
#include <sys/socket.h>
#include <arpa/inet.h>
#include <fcntl.h>
#include <errno.h>
static const char payload[] = "nisi fixed probe\n";
// Closed status byte: 0 skipped, 1 allowed, 2 permission denied, 3 error.
static void row(NSMutableData *out, uint8_t status, int code) {
    [out appendBytes:&status length:1]; append32(out, (uint32_t)code);
}
static void accessRow(NSMutableData *out, BOOL okay, int code) {
    row(out, okay ? 1 : (code == EPERM || code == EACCES) ? 2 : 3, okay ? 0 : code);
}
static void closeRow(NSMutableData *out, int fd) {
    int result = close(fd), saved = result < 0 ? errno : 0;
    row(out, result == 0 ? 1 : 3, saved);
}
static void fileRows(NSMutableData *out, NSString *file, BOOL writing) {
    int fd = open(file.fileSystemRepresentation,
        writing ? O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW : O_RDONLY | O_NOFOLLOW, 0600);
    int saved = fd < 0 ? errno : 0; accessRow(out, fd >= 0, saved);
    if (fd < 0) { row(out, 0, 0); row(out, 0, 0); return; }
    char buffer[sizeof(payload)];
    ssize_t n = writing ? write(fd, payload, sizeof(payload) - 1) : read(fd, buffer, sizeof(buffer));
    saved = n < 0 ? errno : 0;
    BOOL okay = n == (ssize_t)(sizeof(payload) - 1) && (writing || memcmp(buffer, payload, sizeof(payload) - 1) == 0);
    accessRow(out, okay, saved); closeRow(out, fd);
}
static NSData *fixedReply(pid_t peer) {
    NSString *home = NSHomeDirectory();
    // No explicit file/socket operation if sandbox home resolution is unexpected.
    if (![home isEqualToString:NISI_SERVICE_HOME]) return [NSData data];
    NSData *homeData = [home dataUsingEncoding:NSUTF8StringEncoding];
    if (homeData.length == 0 || homeData.length > 1024) return [NSData data];
    NSMutableData *out = [NSMutableData dataWithBytes:"NRS1" length:4];
    [out appendData:[NISI_RUN_ID dataUsingEncoding:NSASCIIStringEncoding]];
    append32(out, (uint32_t)peer); append32(out, (uint32_t)getpid());
    uint8_t n[] = {(uint8_t)(homeData.length >> 8), (uint8_t)homeData.length};
    [out appendBytes:n length:2]; [out appendData:homeData];
    NSString *own = [home stringByAppendingPathComponent:@"nisi-fixed-probe.txt"];
    fileRows(out, own, YES); fileRows(out, own, NO);
    fileRows(out, [NISI_ROOT stringByAppendingPathComponent:@"outside-canary.txt"], NO);
    fileRows(out, [NISI_ROOT stringByAppendingPathComponent:@"outside-write.txt"], YES);
    int fd = socket(AF_INET, SOCK_STREAM, 0), saved = fd < 0 ? errno : 0;
    accessRow(out, fd >= 0, saved);
    if (fd < 0) { row(out, 0, 0); row(out, 0, 0); }
    else {
        struct sockaddr_in address = {0}; address.sin_len = sizeof(address); address.sin_family = AF_INET;
        address.sin_addr.s_addr = htonl(INADDR_LOOPBACK); address.sin_port = 0;
        int result = bind(fd, (struct sockaddr *)&address, sizeof(address)); saved = result < 0 ? errno : 0;
        accessRow(out, result == 0, saved); closeRow(out, fd);
    }
    return [out copy];
}
@interface ProbeHandler : NSObject <NisiFixedProbe>
@property(nonatomic) pid_t peer;
@property(nonatomic) BOOL used;
@property(nonatomic, copy) void (^pendingReply)(NSData *);
@end
@implementation ProbeHandler
- (void)probe:(NSData *)request reply:(void (^)(NSData *))reply {
    BOOL claimed = NO;
    @synchronized(self) { if (!_used) { _used = YES; claimed = YES; } }
    NSXPCConnection *current = NSXPCConnection.currentConnection;
    if (!claimed || !current || current.processIdentifier != _peer || !validRequest(request, _peer)) {
        reply([NSData data]); return;
    }
#if NISI_PROBE_CASE == 2
    // Hold the callback without doing I/O: the fixed client's deadline must win.
    // This does not claim that invalidation instantly terminates the service.
    self.pendingReply = reply;
    return;
#endif
    reply(fixedReply(_peer));
}
@end
@interface ProbeDelegate : NSObject <NSXPCListenerDelegate>
@property(nonatomic) BOOL used;
@end
@implementation ProbeDelegate
- (BOOL)listener:(NSXPCListener *)listener shouldAcceptNewConnection:(NSXPCConnection *)connection {
    (void)listener;
    if (connection.processIdentifier <= 0) return NO;
    @synchronized(self) { if (_used) return NO; _used = YES; }
    ProbeHandler *handler = [ProbeHandler new]; handler.peer = connection.processIdentifier;
    connection.exportedInterface = [NSXPCInterface interfaceWithProtocol:@protocol(NisiFixedProbe)];
    connection.exportedObject = handler;
    [connection activate]; return YES;
}
@end
int main(int argc, const char *argv[]) {
    (void)argv; if (argc != 1) return 64;
    @autoreleasepool {
        struct rlimit cpu = {3, 3}, core = {0, 0};
        if (setrlimit(RLIMIT_CPU, &cpu) != 0 || setrlimit(RLIMIT_CORE, &core) != 0) return 65;
        __attribute__((objc_precise_lifetime)) ProbeDelegate *delegate = [ProbeDelegate new];
        NSXPCListener *listener = NSXPCListener.serviceListener;
        listener.delegate = delegate; [listener resume];
    }
    return 0;
}
