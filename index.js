const Crawler = require('crawler');
const fs = require('fs');
const URL = require('url');
const HTMLParser = require('node-html-parser');

const argv = require('minimist')(process.argv.slice(2));

if(argv._.length < 2 || argv.h || argv.help || argv._[0] === 'help' || ['crawl', 'render'].indexOf(argv._[0]) === -1) {
    console.log(`Usage: node index.js <crawl/render> <url/file> [options]
    crawl  Crawls given URL and saves diagram data to file
    render Renders diagram from file

    Options:
        -c <link>           Connects given URL to previously crawled link.
        -r <css selector>   Removes given CSS selector's elements
        -x <file>           Specify json array file with comments to ignore
        -o <file>           Output file name
        -d                  Debug mode
        -h                  Prints this help message
`);
    return;
}

const action = argv._[0];

if(action === 'crawl') {
    const url = argv._[1];
    const parsedUrl = URL.parse(url);
    const outputFile = argv.o || `${parsedUrl.hostname}.json`;
    const connectTo = argv.c;
    const removeElements = argv.r;
    const ignoreComments = fs.existsSync(argv.x) ? JSON.parse(fs.readFileSync(argv.x)) : null;
    const debug = argv.d;

    if(!fs.existsSync(outputFile)) {
        if(connectTo) {
            return console.log(`File ${outputFile} does not exist. Cannot connect to ${connectTo}`);
        }
        fs.writeFileSync(outputFile, JSON.stringify({}));
    }

    let data = JSON.parse(fs.readFileSync(outputFile));

    if(connectTo) {
        if(!data[connectTo]) {
            return console.log(`Cannot connect to ${connectTo}. No data found for ${connectTo}`);
        }

        if(!data[connectTo].links) {
            data[connectTo].links = [];
        }

        if(data[connectTo].links.indexOf(url) === -1) {
            data[connectTo].links.push(url);
        }

        fs.writeFileSync(outputFile, JSON.stringify(data));
    }

    const c = new Crawler({
        maxConnections: 10,
        callback: function (error, res, done) {
            console.log(`Crawling ${res.request.uri.href}`);
            if(error) {
                return console.error(error);
            }

            let links = [];

            try {
                const dom = HTMLParser.parse(res.body, {
                    comment: true
                });
                const styles = dom.querySelectorAll('style');
                for(let style of styles) {
                    style.remove();
                }
                const scripts = dom.querySelectorAll('script');
                for(let script of scripts) {
                    script.remove();
                }
                if(removeElements) {
                    const toRemove = dom.querySelectorAll(removeElements);
                    for(let el of toRemove) {
                        el.remove();
                    }
                }
    
                const text = dom.querySelector('body').innerText
                    .trim()
                    .replace(/&nbsp;/g, ' ')
                    .replace(/&quot;/g, '"')
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&apos;/g, '\'')
                    .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec));
                links = dom.querySelectorAll('a').map(link => link.getAttribute('href')).filter(u => u);
                const images = dom.querySelectorAll('img').map(img => img.getAttribute('src')).filter(u => u);
                const comments = [];
                function getComments(el) {
                    if(el.nodeType === 8) {
                        let rt = el.rawText.trim();
                        if(ignoreComments && ignoreComments.indexOf(rt) !== -1) {
                            return;
                        }
                        if(rt) comments.push(rt);
                    } else {
                        for(let child of el.childNodes) {
                            getComments(child);
                        }
                    }
                }
                getComments(dom);

                data[res.request.uri.href] = {
                    text,
                    links,
                    images,
                    comments
                };

                if(debug) {
                    console.log(data[res.request.uri.href]);
                }

                fs.writeFileSync(outputFile, JSON.stringify(data));
            } catch(e) {
                console.error(`Error parsing ${res.request.uri.href}`, e);
            }

            for(let link of links) {
                if(!data[link]) {
                    c.queue(link);
                }
            }

            done();
        }
    });

    c.queue(url);
}

