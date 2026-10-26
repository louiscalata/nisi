// Synthetic test process only. Does not link or call Foundation Models.
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/stat.h>

int main(int argc, char **argv) {
    if (argc != 1) return 64;
    int marker = open("started", O_WRONLY | O_CREAT | O_EXCL, 0600);
    if (marker < 0) return 65;
    close(marker);
    char mode[32] = {0};
    FILE *configuration = fopen("mode", "r");
    if (!configuration) return 66;
    (void)fgets(mode, sizeof(mode), configuration); fclose(configuration);
    if (!strcmp(mode, "wait")) while (access("release", F_OK) != 0) usleep(1000);
    if (!strcmp(mode, "hang")) for (;;) pause();
    if (!strcmp(mode, "stderr")) { fputs("SYNTHETIC_ERROR\n", stderr); fflush(stderr); for (;;) pause(); }
    if (!strcmp(mode, "overflow")) { for (int i = 0; i < 20000; i++) putchar('x'); fflush(stdout); return 0; }
    FILE *payload = fopen("payload.json", "rb");
    if (!payload) return 67;
    int value;
    while ((value = fgetc(payload)) != EOF) putchar(value);
    fclose(payload); fflush(stdout);
    if (!strcmp(mode, "late")) for (;;) pause();
    if (!strcmp(mode, "tamper")) (void)chmod(argv[0], 0600);
    return !strcmp(mode, "nonzero") ? 2 : 0;
}
