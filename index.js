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
        -i <file>           Specify json array file with links to ignore
        -t <file>           Specify json file with text to remove
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
    const ignoreLinks = fs.existsSync(argv.i) ? JSON.parse(fs.readFileSync(argv.i)) : null;
    const removeText = fs.existsSync(argv.t) ? JSON.parse(fs.readFileSync(argv.t)) : null;
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
            let url = res?.request?.uri?.href;
            if(url?.endsWith?.('/')) {
                url = url.slice(0, -1);
            }
            if(!url || data[url]) {
                return done();
            }
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
    
                let text = dom.querySelector('body').innerText
                    .trim()
                    .replace(/&nbsp;/g, ' ')
                    .replace(/&quot;/g, '"')
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&apos;/g, '\'')
                    .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec));

                if(removeText) {
                    for(let textToRemove of removeText) {
                        text = text.replaceAll(textToRemove, '');
                    }
                }
                
                links = dom.querySelectorAll('a').map(link => link.getAttribute('href')).filter(u => {
                    if(!u) return false;
                    if(u.startsWith('#')) return false;
                    if(ignoreLinks) {
                        for(let ignore of ignoreLinks) {
                            if(ignore.endsWith("$")) {
                                if(u.endsWith(ignore.slice(0, -1))) {
                                    return false;
                                }
                            }
                            if(u.includes(ignore)) return false;
                        }
                    }
                    return true;
                });
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

                data[url] = {
                    text,
                    links,
                    images,
                    comments
                };

                if(debug) {
                    console.log(url, data[res.request.uri.href]);
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

    for(let link in data) {
        if(data[link].links) {
            loop:
            for(let l of data[link].links) {
                if(!data[l]) {
                    if(ignoreLinks) {
                        for(let ignore of ignoreLinks) {
                            if(l.includes(ignore)) continue loop;
                        }
                    }
                    c.queue(l);
                }
            }
        }
    } 
} else if(action === 'render') {
    let file = argv._[1];
    if(!fs.existsSync(file)) {
        return console.log(`File ${file} does not exist`);
    }
    const outputFile = argv.o || file.replace('.json', '.html');
    const ignoreComments = fs.existsSync(argv.x) ? JSON.parse(fs.readFileSync(argv.x)) : null;
    const ignoreLinks = fs.existsSync(argv.i) ? JSON.parse(fs.readFileSync(argv.i)) : null;
    const removeText = fs.existsSync(argv.t) ? JSON.parse(fs.readFileSync(argv.t)) : null;

    let data = JSON.parse(fs.readFileSync(file));
    let tree = [];
    // transform data to tree
    for(let url in data) {
        let node = {
            name: url,
            children: []
        };
        if(data[url].links) {
            for(let link of data[url].links) {
                node.children.push({
                    name: link,
                    children: []
                });
            }
        }
        tree.push(node);
    }

    let html = `
    <html>
        <head>
            <style>
                body {
                    font-family: sans-serif;
                }
                .node {
                    padding: 5px;
                    border: 1px solid #ccc;
                    border-radius: 5px;
                    margin: 5px;
                    display: inline-block;
                }
                .node:hover {
                    background-color: #eee;
                }
                .node .name {
                    font-weight: bold;
                }
                .comments {
                    font-style: italic;
                }
                .images img {
                    width: 50px;
                    height: 50px;
                    object-fit: cover;
                    margin: 5px;
                }
            </style>
        </head>
        <body>
            <div class="tree">
                ${renderTree(tree)}
            </div>
        </body>
    </html>
    `;

    function renderTree(tree) {
        let html = '';
        loop:
        for(let node of tree) {
            let link = data[node.name];
            if(!link) continue;
            if(ignoreLinks) {
                for(let ignore of ignoreLinks) {
                    if(ignore.endsWith("$")) {
                        if(node.name.endsWith(ignore.slice(0, -1))) {
                            continue loop;
                        }
                    }
                    if(node.name.includes(ignore)) {
                        continue loop;
                    }
                }
            }
            if(removeText) {
                for(let textToRemove of removeText) {
                    link.text = link.text.replace(/\s+/g, ' ').replaceAll(textToRemove, '');
                }
            }
            html += `<div class="node"><a class="name" href="${node.name}" target="_blank">${node.name}</a><br>` +
                `<span class="text">${link.text}</span><br>` +
                `<span class="comments">${link.comments.join('<br>')}</span><br>` +
                `<span class="images">${link.images.map(i => `<a href="${i}" target="_blank"><img src="${i}"></a>`).join('')}</span><br>`;
            if(node.children.length) {
                html += `<div class="children">${renderTree(node.children)}</div>`;
            }
            html += '</div>';
        }
        return html;
    }

    fs.writeFileSync(outputFile, html);
}