#include "VeritasSQLiteSupport.h"

int veritas_sqlite3_enable_no_checkpoint_on_close(
    sqlite3 *database,
    int *enabled
) {
    return sqlite3_db_config(
        database,
        SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE,
        1,
        enabled
    );
}
