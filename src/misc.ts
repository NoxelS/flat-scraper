import { createWriteStream, unlinkSync } from 'fs';
import { get } from 'https';


export const download = (url, destination) =>
    new Promise((resolve, reject) => {
        const file = createWriteStream(destination);

        get(url, response => {
                response.pipe(file);

                file.on('finish', () => {
                    file.close(() => resolve(true));
                });
            })
            .on('error', error => {
                unlinkSync(destination);
                reject(error.message);
            });
    });
