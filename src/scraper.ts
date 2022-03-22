import { config } from 'dotenv';
import { createPool, Pool, PoolConfig } from 'mysql';
import { schedule } from 'node-cron';
import TelegramBot from 'node-telegram-bot-api';
import { Configuration, OpenAIApi } from 'openai';
import Puppeteer, { launch, LaunchOptions } from 'puppeteer';


/** Only use .env files when running in dev mode */
if (!process.env.produtction) config();

const telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN || '', { polling: true });
const flatChannel = process.env.TELEGRAM_CHANNEL_ID || '';

const sendTelegramMessage = msg => telegramBot.sendMessage(flatChannel, msg);
const sendDebugMessage = msg => (msg ? telegramBot.sendMessage(process.env.TELEGRAM_DEBUG_CHANNEL_ID || '', msg) : null);

export const ebay =
    'https://www.ebay-kleinanzeigen.de/s-wohnung-mieten/saarbruecken-mitte/preis::950/wohnung/k0c203l16859+wohnung_mieten.verfuegbarm_i:4%2C+wohnung_mieten.verfuegbary_i:2022%2C+wohnung_mieten.zimmer_d:2%2C';
export const itemSpacer = '\n\n';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function scrape(pool: Pool) {
    const configuration = new Configuration({
        apiKey: process.env.OPENAI_API_KEY
    });
    const openai = new OpenAIApi(configuration);

    const browser = await Puppeteer.launch(<LaunchOptions>{
        headless: false,
        args: ['--no-sandbox', '--disable-gpu'],
        timeout: 0
    });

    const page = await browser.newPage();
    sendDebugMessage('Ich gehe gerade auf Ebay.');
    await page.goto(ebay);

    /** Items are text array of the html <article> node inner text. */
    const { count, sort } = await page.evaluate(() => {
        const count = document.querySelector('.breadcrump-summary')?.textContent;
        const sort = document.querySelector('#sortingField-selector-inpt')?.textContent;
        return {
            count,
            sort
        };
    });

    /** Post message for daily count of flats for sale */
    sendDebugMessage(`Zurzeit gibt es ${count?.split(' von ')[1]}.`);

    // const openAiString = `Zurzeit gibt es ${count?.split(' von ')[1]} Wohnungen zu mieten in Saarbrücken. Schreibe bitte ein kurzes Gedicht dazu!
    //     `;
    // console.log(openAiString);

    // const completion = await openai.createCompletion('text-davinci-002', {
    //     prompt: openAiString,
    //     temperature: 0.29,
    //     max_tokens: 128,
    //     top_p: 1,
    //     frequency_penalty: 0,
    //     presence_penalty: 0
    // });

    // const openAiAntwort = (completion as any).data.choices[0].text;

    // console.log(openAiAntwort);

    /** Wait for the site to render */
    await delay(1000);

    /** Click away the cookie banner (yeah we accept it because we are good people :) */
    await page.click('#gdpr-banner-accept');

    const articleLinks = await page.evaluate(() => {
        const links: string[] = [];
        document.querySelectorAll('article')?.forEach(a => links.push(a.dataset['href'] || ''));
        return links;
    });

    sendDebugMessage(`Ich habe viele Anzeigen gefunden. (${articleLinks.length})`);

    for (let i = 0; i < articleLinks.length; i++) {
        const url = articleLinks[i];
        await page.goto(`https://www.ebay-kleinanzeigen.de${url}`);
        await delay(1000);
        const { props, values, checktags, title, views, location, date } = await page.evaluate(() => {
            const props: string[] = [];
            document.querySelectorAll('li.addetailslist--detail')?.forEach(a =>
                props.push(
                    a.innerHTML
                        .replace(/(\r\n|\n|\r)/gm, '')
                        .trim()
                        .split('<')[0] || ''
                )
            );
            const values: string[] = [];
            document.querySelectorAll('span.addetailslist--detail--value')?.forEach(a => values.push(a.innerHTML.replace(/(\r\n|\n|\r)/gm, '').trim() || ''));

            const checktags: string[] = [];
            document.querySelectorAll('li.checktag')?.forEach(a => checktags.push(a.innerHTML.replace(/(\r\n|\n|\r)/gm, '').trim() || ''));
            const title = document
                .querySelector('#viewad-title')
                ?.textContent?.replace(/(\r\n|\n|\r)/gm, '')
                .replace(/<[^>]*>/g, '')
                .trim()
                .slice(
                    document
                        .querySelector('#viewad-title')
                        ?.textContent?.replace(/(\r\n|\n|\r)/gm, '')
                        .replace(/<[^>]*>/g, '')
                        .trim()
                        .lastIndexOf('•'),
                    document
                        .querySelector('#viewad-title')
                        ?.textContent?.replace(/(\r\n|\n|\r)/gm, '')
                        .replace(/<[^>]*>/g, '')
                        .trim().length
                )
                .replace('•                     ', '');
            const views = document
                .querySelector('#viewad-cntr-num')
                ?.innerHTML.replace(/(\r\n|\n|\r)/gm, '')
                .replace(/<[^>]*>/g, '')
                .trim();
            const date = (document.querySelector('#viewad-extra-info')?.children[0] as any)?.innerText
                .replace(/(\r\n|\n|\r)/gm, '')
                .replace(/<[^>]*>/g, '')
                .trim();
            const location = (
                document
                    .querySelector('#street-address')
                    ?.innerHTML.replace(/(\r\n|\n|\r)/gm, '')
                    .replace(/<[^>]*>/g, '')
                    ?.trim() +
                '' +
                document
                    .querySelector('#viewad-locality')
                    ?.innerHTML.replace(/(\r\n|\n|\r)/gm, '')
                    .replace(/<[^>]*>/g, '')
                    ?.trim()
            ).replace('&nbsp;', '');

            return { props, values, checktags, title, views, location, date };
        });

        if (props.length !== values.length) {
            sendDebugMessage('Somethign went wront while getting more info about the flat');
            throw new Error('Somethign went wront while getting more info about the flat');
        }

        const flatProps = {};

        for (let i = 0; i < props.length; i++) {
            flatProps[props[i]] = values[i];
        }

        await delay(1000);
        const mapLocation = await page.$('#viewad-map');
        await delay(1000);
        let hasLocationImg = false;
        if (mapLocation) {
            await mapLocation.screenshot({ path: `./images/location-${encodeURI(title || '') + i}.png` });
            hasLocationImg = true;
        }

        const flat = {
            title,
            views,
            location,
            date,
            checktags,
            flatProps,
            hasLocationImg,
            path: `./images/location-${encodeURI(title || '') + i}.png`,
            id: encodeURI(title || '') + i
        };

        sendDebugMessage('Neue Wohnung:');
        sendDebugMessage(JSON.stringify(flat));

        const text = `Eine neue Wohnung ist seit ${date} online und hat bereits ${views} Aufrufe!

Der Titel lautet "${title}" und sie befindet sich in ${location}.

Weitere Details:
${Object.keys(flatProps)
    .map(k => `\t • ${k}: ${flatProps[k]}`)
    .join('\r\n')}

Folgende zusätliche Infos habe ich gefunden:
${checktags.map(c => `\t • ${c} ✓`).join('\r\n')}

Du findest sie unter ${`https://www.ebay-kleinanzeigen.de${url}`}
`;

        if (hasLocationImg) {
            telegramBot.sendPhoto(flatChannel, `./images/location-${i}.png`, { caption: text });
        } else {
            sendTelegramMessage(text);
        }

        await delay(1000);
    }

    await browser.close();
}

const pool: Pool = createPool(<PoolConfig>{
    host: process.env.HOST,
    user: process.env.USER,
    password: process.env.PASSWORD,
    database: process.env.DATABASE,
    port: process.env.PORT
});

// Scrape every 15 minutes if production mode is enabled (https://crontab.guru is your best friend)

if (!process.env.production) {
    console.log('Scraping...');
    scrape(pool);
} else {
    const interval = process.env.production ? '*/30 * * * *' : '* * * * *';
    console.log(`Scraping every ${process.env.production ? '15 minutes' : 'minute'}.`);
    schedule(interval, () => scrape(pool));
}
