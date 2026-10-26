// PRIVATE fixed capability fixture. No candidate, command, path or env input.
// Emits fixture-adjudicated syscall labels, not a general execution attestation.
#import <Foundation/Foundation.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <sys/resource.h>
#include <arpa/inet.h>
#include <spawn.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <string.h>
#include "probe-config.h"

#ifndef NISI_EXPECT_SANDBOX
#define NISI_EXPECT_SANDBOX 1
#endif
#if NISI_EXPECT_SANDBOX != 0 && NISI_EXPECT_SANDBOX != 1
#error invalid fixed mode
#endif
static const char payload[] = "nisi fixed probe\n";

static void emitObject(NSDictionary *object) {
    NSError *error = nil;
    NSData *data = [NSJSONSerialization dataWithJSONObject:object options:NSJSONWritingSortedKeys error:&error];
    if (error || !data || fwrite(data.bytes, 1, data.length, stdout) != data.length ||
        fputc('\n', stdout) == EOF || fflush(stdout) != 0) _exit(67);
}
static void row(NSString *operation, NSString *outcome, int code) {
    emitObject(@{ @"operation": operation, @"outcome": outcome, @"errno": @(code) });
}
static void accessResult(NSString *operation, BOOL ok, int code) {
    row(operation, ok ? @"ALLOWED" : (code == EPERM || code == EACCES) ? @"DENIED" : @"ERROR", ok ? 0 : code);
}
static void closeResult(NSString *operation, int fd) {
    int result = close(fd), saved = result < 0 ? errno : 0;
    row(operation, result == 0 ? @"ALLOWED" : @"ERROR", saved);
}
static void writeFile(NSString *prefix, NSString *file) {
    NSString *first = [prefix stringByAppendingString:@"-open-write"];
    NSString *middle = [prefix stringByAppendingString:@"-write"];
    NSString *last = [prefix stringByAppendingString:@"-close-write"];
    int fd = open(file.fileSystemRepresentation, O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW, 0600);
    int saved = fd < 0 ? errno : 0;
    accessResult(first, fd >= 0, saved);
    if (fd < 0) { row(middle, @"NOT_RUN", 0); row(last, @"NOT_RUN", 0); return; }
    ssize_t count = write(fd, payload, sizeof(payload) - 1);
    saved = count < 0 ? errno : 0;
    accessResult(middle, count == (ssize_t)(sizeof(payload) - 1), saved);
    closeResult(last, fd);
}
static void readFile(NSString *prefix, NSString *file) {
    NSString *first = [prefix stringByAppendingString:@"-open-read"];
    NSString *middle = [prefix stringByAppendingString:@"-read"];
    NSString *last = [prefix stringByAppendingString:@"-close-read"];
    int fd = open(file.fileSystemRepresentation, O_RDONLY | O_NOFOLLOW);
    int saved = fd < 0 ? errno : 0;
    accessResult(first, fd >= 0, saved);
    if (fd < 0) { row(middle, @"NOT_RUN", 0); row(last, @"NOT_RUN", 0); return; }
    // One extra byte detects a trailing payload; short/partial reads are ERROR.
    char buffer[sizeof(payload)];
    ssize_t count = read(fd, buffer, sizeof(buffer));
    saved = count < 0 ? errno : 0;
    BOOL exact = count == (ssize_t)(sizeof(payload) - 1) && memcmp(buffer, payload, sizeof(payload) - 1) == 0;
    accessResult(middle, exact, saved);
    closeResult(last, fd);
}
int main(int argc, const char *argv[]) {
    (void)argv;
    if (argc != 1) return 64;
    @autoreleasepool {
        struct rlimit cpu = {3, 3}, core = {0, 0};
        if (setrlimit(RLIMIT_CPU, &cpu) != 0 || setrlimit(RLIMIT_CORE, &core) != 0) return 65;
        NSString *home = NSHomeDirectory();
        // Refuse before writes if sandbox resolution unexpectedly names real home.
        if (NISI_EXPECT_SANDBOX && ![home isEqualToString:NISI_SANDBOX_HOME]) return 66;
        emitObject(@{ @"schemaVersion": @"nisi-fixed-probe-v1", @"runId": NISI_RUN_ID,
            @"mode": NISI_EXPECT_SANDBOX ? @"sandbox" : @"control", @"pid": @(getpid()), @"home": home });
        NSString *own = NISI_EXPECT_SANDBOX ? [home stringByAppendingPathComponent:@"nisi-fixed-probe.txt"] : [NISI_ROOT stringByAppendingPathComponent:@"own-control.txt"];
        writeFile(@"own", own);
        readFile(@"own", own); // independent: no write failure can erase this check
        readFile(@"outside", [NISI_ROOT stringByAppendingPathComponent:@"outside-canary.txt"]);
        writeFile(@"outside", [NISI_ROOT stringByAppendingPathComponent:@"outside-write.txt"]);
        int fd = socket(AF_INET, SOCK_STREAM, 0), saved = fd < 0 ? errno : 0;
        accessResult(@"socket-create", fd >= 0, saved);
        if (fd < 0) { row(@"socket-bind", @"NOT_RUN", 0); row(@"socket-close", @"NOT_RUN", 0); }
        else {
            struct sockaddr_in address = {0};
            address.sin_len = sizeof(address); address.sin_family = AF_INET;
            address.sin_addr.s_addr = htonl(INADDR_LOOPBACK); address.sin_port = 0;
            int result = bind(fd, (struct sockaddr *)&address, sizeof(address)); saved = result < 0 ? errno : 0;
            accessResult(@"socket-bind", result == 0, saved); closeResult(@"socket-close", fd);
        }
        pid_t child = -1;
        char *args[] = {"/usr/bin/true", NULL}, *env[] = {"PATH=/usr/bin:/bin", NULL};
        int result = posix_spawn(&child, "/usr/bin/true", NULL, NULL, args, env);
        accessResult(@"fixed-child-spawn", result == 0, result); // spawn returns its error, not errno
        if (result != 0) row(@"fixed-child-wait", @"NOT_RUN", 0);
        else {
            int status = 0; pid_t ended = waitpid(child, &status, 0); saved = ended < 0 ? errno : 0;
            BOOL ok = ended == child && WIFEXITED(status) && WEXITSTATUS(status) == 0;
            row(@"fixed-child-wait", ok ? @"ALLOWED" : @"ERROR", saved);
        }
    }
    return 0;
}
