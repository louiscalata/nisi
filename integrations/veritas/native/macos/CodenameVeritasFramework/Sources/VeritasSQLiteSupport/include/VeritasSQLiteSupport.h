#ifndef VERITAS_SQLITE_SUPPORT_H
#define VERITAS_SQLITE_SUPPORT_H

#include <sqlite3.h>

int veritas_sqlite3_enable_no_checkpoint_on_close(
    sqlite3 *database,
    int *enabled
);

#endif
