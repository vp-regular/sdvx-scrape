import * as cheerio from 'cheerio';
import retry from 'async-retry';
import fetch from 'node-fetch';
import { writeFile, createWriteStream, existsSync, mkdirSync } from 'node:fs';
import {pipeline} from 'node:stream';
import {promisify} from 'node:util';

const SDVX_BASE_URL = 'https://p.eagate.573.jp'
const SDVX_SONGLIST_ENDPOINT = '/game/eacsdvx/vi/music/index.html'


function scrapeDetailedPage(endpoint) {
    var difficulties_json = {}
    retry(async bail => {
        await fetch(SDVX_BASE_URL + endpoint)
        .then(res => res.arrayBuffer())
        .then(buffer => {
                const decoder = new TextDecoder('shift_jis');
                const data = decoder.decode(buffer)
                const $ = cheerio.load(data)
                
                var song_name = $($('.info').find('p').get(0)).text()

                $('.cat').each((i, difficulty_div) => {
                    const { difficulty_name_and_rating, difficulty_illustrator, difficulty_effector } = scrapeDifficultyDataInDetailPage($, difficulty_div, song_name);
                    difficulties_json[difficulty_name_and_rating[0]] = {
                        level: difficulty_name_and_rating[1],
                        illustrator: difficulty_illustrator,
                        effector: difficulty_effector
                    }
                })
            }
        )
    },
    {retries: 20})
    
    return difficulties_json
}

function scrapeDifficultyDataInDetailPage($, difficulty_div, song_name) {
    const p_tag_cheerios = $(difficulty_div).find('p');
    const difficulty_name_and_rating = getDifficulty(p_tag_cheerios.get(0), $);
    const difficulty_illustrator = $(p_tag_cheerios.get(1)).text();
    const difficulty_effector = $(p_tag_cheerios.get(2)).text();

    saveJacketToDisk(song_name, difficulty_name_and_rating, $, difficulty_div);

    return { difficulty_name_and_rating, difficulty_illustrator, difficulty_effector };
}

function saveJacketToDisk(song_name, difficulty_name_and_rating, $, difficulty_div) {
    var dir_to_save = `./jackets/${song_name}/${difficulty_name_and_rating[0]}`;

    if (!existsSync(dir_to_save)) {
        mkdirSync(dir_to_save, { recursive: true });
    }

    const img_endpoint = SDVX_BASE_URL + $(difficulty_div).find('img').attr()['src'];

    const streamPipeline = promisify(pipeline);
    retry(async bail => {
        fetch(img_endpoint)
        .then(response => {
            streamPipeline(response.body, createWriteStream(`${dir_to_save}/jacket.jpg`));
        })
    },
    {retries : 20}
    )
}

function getDifficulty(cheerio_element, api) {
    let difficulty_name = api(cheerio_element).attr()['class'].toUpperCase()
    let difficulty_rating = api(cheerio_element).text()
    return [difficulty_name, difficulty_rating];
}

// [
//     {
//         title: 'title',
//         artist: 'artist',
//         difficulties: {
//             'nov' : { 'level' : x, 'effector' : y, 'illustrator' : z}
//         }
//         pack_name: 'name'
//     }
// ]

let pageNum = 1;
var done = false;
let songs = []

while (!done) {
    await retry(async bail => {
        await fetch(`${SDVX_BASE_URL + SDVX_SONGLIST_ENDPOINT}?page=${pageNum}`)
        .then(res => res.arrayBuffer())
        .then(buffer => {
    
            const decoder = new TextDecoder('shift_jis');
            const data = decoder.decode(buffer)
            const $ = cheerio.load(data)
    
            if ($('.music').length == 0) {
                done = true
                return false;
            }
    
            $('div.music').each((i, music_div) => {
                var difficulties_data = {}
                $(music_div).find('.jk').each((i, jacket_html) => {
                    var detailed_page_endpoint = $($(jacket_html).find('a').get(0)).attr()['href']
                    difficulties_data = scrapeDetailedPage(detailed_page_endpoint)
                }
                )
                $(music_div).find('.inner').each((i, song_html) => {
                    $(song_html).find('.info').each((i, song_html_div) => {
    
                        // songs metadata -> json
                        var p_tag_cheerios = $(song_html_div).find('p')
                        const title = $(p_tag_cheerios.get(0)).text()
                        const artist = $(p_tag_cheerios.get(1)).text()
    
                        var pack_name = null
    
                        if ($(p_tag_cheerios.get(5)).attr()['class'] != undefined) {
                            pack_name = $(p_tag_cheerios.get(6)).text()
                        }
                        else {
                            pack_name = $(p_tag_cheerios.get(5)).text()
                        }
    
                        songs.push({
                            title: title,
                            artist: artist,
                            difficulties: difficulties_data,
                            pack_name: pack_name
                        })
    
                    })
                })
            })
        })
    },
    {retries: 20})
    pageNum++
}

console.log(songs.length)
let json_string = JSON.stringify(songs, null, 4)
writeFile('./songs.json', json_string, (err) => {})