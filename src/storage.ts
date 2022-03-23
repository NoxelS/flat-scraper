import { MysqlError, Pool } from 'mysql';


function query(query: string, inputs: any[], callback: (error: MysqlError, result: any[]) => void, pool: Pool) {
    pool.getConnection(function (error, connection) {
        connection.beginTransaction(function (error) {
            if (error) {
                // Transaction Error (Rollback and release connection)
                connection.rollback(function () {
                    connection.release();
                    callback(error, []);
                });
            } else {
                connection.query(query, inputs, function (error, results) {
                    if (error) {
                        // Query Error (Rollback and release connection)
                        connection.rollback(function () {
                            connection.release();
                            callback(error, []);
                        });
                    } else {
                        connection.commit(function (error) {
                            if (error) {
                                connection.rollback(function () {
                                    connection.release();
                                    callback(error, []);
                                });
                            } else {
                                connection.release();
                                callback(error, results);
                            }
                        });
                    }
                });
            }
        });
    });
}

/**
 * @param article Article that will be stored
 * @param pool Connectin pool
 * @description Will only store a flat if the uniqueKey is unique in the database.
 */
export function storeFlat(pool, flat: { title; views; location; date; checktags; flatProps; hasLocationImg; images; path; id }, callback) {
    const uID = encodeURI(flat.title).substring(0, 150);
    query(
        'SELECT * FROM flats WHERE uID = ?',
        [uID],
        (err, result) => {
            if (err || !result.length) {
                // Article does not exist
                console.log(`Found new flat in ${flat.location}!`);
                query(
                    'INSERT INTO `flatscraper`.`flats` (`uID`, `title`, `location`, `date`, `checktags`, `flatProps`, `hasLocationImg`, `images`, `path`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);',
                    [
                        uID,
                        flat.title,
                        flat.location,
                        flat.date,
                        JSON.stringify(flat.checktags),
                        JSON.stringify(flat.flatProps),
                        JSON.stringify(flat.hasLocationImg),
                        JSON.stringify(flat.images),
                        flat.path
                    ],
                    err => {
                        if (err) {
                            throw err;
                        } else {
                            callback();
                        }
                    },
                    pool
                );
            } else {
                console.log("Found this article already...");
            }
        },
        pool
    );
}
