const Crawler = require('crawler');
const fs = require('fs');
const URL = require('url');
const HTMLParser = require('node-html-parser');

const argv = require('minimist')(process.argv.slice(2));

if(
    argv._.length < 2 || argv.h || argv.help || argv._[0] === 'help' || 
    ['crawl', 'render', 'comment', 'clean', 'restore', 'revert', 'undo', 'reverse', 'prev'].indexOf(argv._[0]) === -1
) {
    console.log(`Usage: node index.js [params] [options]

Params:
    crawl   <url>           Crawls given URL and saves diagram data to file
    render  <file>          Renders diagram from file
    comment <url> <comment> Adds comment to URL in file
    clean   <file> <text>   Removes all urls containing given text from file
    restore <file>          Restores file to previous version

Ignore text file can end with $ to indicate that the text should be matched at the end of the url.
Clean text file can start with ^ to indicate that the text should be matched at the start of the url.

Options:
    -c <link>           Connects given URL to previously crawled link.
    -r <css selector>   Removes given CSS selector's elements
    -x <file>           Specify json array file with comments to ignore
    -i <file>           Specify json array file with links to ignore
    -t <file>           Specify json file with text to remove
    -w <file>           Whitelist links
    -o <file>           Output file name
    -m                  Treat url as array of urls split by comma
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
    const whitelist = fs.existsSync(argv.w) ? JSON.parse(fs.readFileSync(argv.w)) : null;
    const debug = argv.d;
    const array = argv.m;

    if(!fs.existsSync(outputFile)) {
        if(connectTo) {
            return console.log(`File ${outputFile} does not exist. Cannot connect to ${connectTo}`);
        }
        fs.writeFileSync(outputFile, JSON.stringify({}));
    }

    let data = JSON.parse(fs.readFileSync(outputFile));

    fs.writeFileSync(`${outputFile}.prev`, JSON.stringify(data));

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

                if(!dom.querySelector('body')) {
                    return done();
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
                    if(u.startsWith('javascript:')) return false;
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
                    if(whitelist) {
                        let match = false;
                        for(let link of whitelist) {
                            if(u.includes(link)) {
                                match = true;
                                break;
                            }
                        }
                        if(!match) return false;
                    }
                    return true;
                }).map(u => {
                    if(!u.startsWith('http')) {
                        if(u.startsWith('/')) {
                            return `${parsedUrl.protocol}//${parsedUrl.host}${u}`;
                        } else {
                            return `${url}/${u}`;
                        }
                    }
                    return u;
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
                    links: [...new Set(links)],
                    images: [...new Set(images)],
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

    if(array) {
        let urls = url.split(',');
        for(let u of urls) {
            c.queue(u);
        }
    } else {
        c.queue(url);
    }

    for(let link in data) {
        if(data[link].links) {
            loop:
            for(let l of data[link].links) {
                if(!l) continue;
                if(l.startsWith('#')) continue;
                if(l.startsWith('javascript:')) continue;

                if(!l.startsWith('http')) {
                    if(l.startsWith('/')) {
                        let parsedUrl = URL.parse(link);
                        l = `${parsedUrl.protocol}//${parsedUrl.host}${l}`;
                    } else {
                        l = `${link}/${l}`;
                    }
                }
                if(!data[l]) {
                    if(ignoreLinks) {
                        for(let ignore of ignoreLinks) {
                            if(l.includes(ignore)) continue loop;
                        }
                    }
                    if(whitelist) {
                        let match = false;
                        for(let ignore of whitelist) {
                            if(l.includes(ignore)) {
                                match = true;
                                break;
                            }
                        }
                        if(!match) continue loop;
                    }
                    console.log(`Adding ${l} to queue`);
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
    const whitelist = fs.existsSync(argv.w) ? JSON.parse(fs.readFileSync(argv.w)) : null;

    let data = JSON.parse(fs.readFileSync(file));
    let tree = [];
    // transform data to tree
    for(let url in data) {
        let node = {
            name: url,
            children: []
        };
        if(data[url].links) {
            let links = [...new Set(data[url].links)];
            for(let link of links) {
                if(!link) continue;
                if(link.startsWith('#')) continue;
                if(link.startsWith('javascript:')) continue;

                if(!link.startsWith('http')) {
                    if(link.startsWith('/')) {
                        let parsedUrl = URL.parse(url);
                        link = `${parsedUrl.protocol}//${parsedUrl.host}${link}`;
                    } else {
                        link = `${url}/${link}`;
                    }
                }
                node.children.push({
                    name: link,
                    children: []
                });
            }
        }
        tree.push(node);
    }

    let html = /*html*/`
    <html>
        <head>
            <script src="https://d3js.org/d3.v7.min.js"></script>
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
                    overflow: hidden;
                    background-color: #fff;
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
                .author-comments {
                    font-style: italic;
                    font-weight: bold;
                }
                foreignObject { overflow: visible; }
            </style>
        </head>
        <body>
            <div id="chart"></div>
            <div class="tree">
                ${renderTree(tree)}
            </div>
            <script>
                const width = window.innerWidth;
                const height = window.innerHeight;

                const tree = ${JSON.stringify(data)};
                const data = {
                    nodes: [],
                    links: []
                };
                for(let url in tree) {
                    let node = tree[url];
                    data.nodes.push({
                        id: url,
                        group: 1
                    });
                    for(let child of node.links) {
                        if(tree[child]) {
                            data.links.push({
                                source: url,
                                target: child
                            });
                        }
                    }
                }

                function chart() {
                    // Specify the color scale.
                    const color = d3.scaleOrdinal(d3.schemeCategory10);

                    // The force simulation mutates links and nodes, so create a copy
                    // so that re-evaluating this cell produces the same result.
                    const links = data.links.map(d => ({...d}));
                    const nodes = data.nodes.map(d => ({...d}));

                    // Create a simulation with several forces.
                    const simulation = d3.forceSimulation(nodes)
                        .force("link", d3.forceLink(links).distance(l => {
                            return Math.max(tree[l.target.id].links.length * 200, 200);
                        }).id(d => d.id))
                        .force("charge", d3.forceManyBody().strength(-5000).distanceMax(5000))
                        .force("center", d3.forceCenter(width / 2, height / 2))
                        .on("tick", ticked);

                    // Create the SVG container.
                    const svg = d3.create("svg")
                        .attr("width", innerWidth)
                        .attr("height", innerHeight)
                        .attr("viewBox", [0, 0, width, height])
                        .attr("style", "max-width: 100%; height: auto;")
                        .call(d3.zoom().on("zoom", function (event) {
                            node.attr("transform", event.transform)
                            link.attr("transform", event.transform)
                        }))

                    // add arrow markers
                    svg.append("defs").selectAll("marker")
                        .data(["end"])
                        .join("marker")
                        .attr("id", "marker")
                        .attr("viewBox", "0 -5 10 10")
                        .attr("refX", 100)
                        .attr("refY", 0)
                        .attr("markerWidth", 20)
                        .attr("markerHeight", 20)
                        .attr("orient", "auto")
                        .append("path")
                        .attr("fill", "#999")
                        .attr("d", "M0,-5L10,0L0,5");


                    // Add a line for each link, and a circle for each node.
                    const link = svg.append("g")
                        .attr("stroke", "#999")
                        .attr("stroke-opacity", 0.6)
                        .selectAll("line")
                        .data(links)
                        .join("line")
                        .attr("marker-end", "url(#marker)");

                    const node = svg.append("g")
                        .attr("stroke", "#fff")
                        .attr("stroke-width", 1.5)
                        .selectAll("foreignObject")
                        .data(nodes)
                        .join("foreignObject")
                        .attr("width", 200)
                        .attr("height", 200);

                    node.append("xhtml:div")
                        .append('div')
                        .attr("class", "node")
                        .attr("style", d => 'background-color: ' + color(d.group) + ')')
                        .html(d => {
                            let html = '<div class="name"><a target="_blank" href="' + d.id + '">'  + d.id + '</a></div>';
                            if(tree[d.id].text) {
                                html += '<div class="text">' + tree[d.id].text + '</div>';
                            }
                            if(tree[d.id].comments) {
                                html += '<div class="comments">' + tree[d.id].comments + '</div>';
                            }
                            if(tree[d.id].images) {
                                html += '<div class="images">';
                                for(let image of tree[d.id].images) {
                                    html += '<img src="' + image + '">';
                                }
                                html += '</div>';
                            }
                            if(tree[d.id].authorComments) {
                                html += '<div class="author-comments">' + tree[d.id].authorComments + '</div>';
                            }
                            return html;
                        });

                    // Add a drag behavior.
                    node.call(d3.drag()
                            .on("start", dragstarted)
                            .on("drag", dragged)
                            .on("end", dragended));

                    // Set the position attributes of links and nodes each time the simulation ticks.
                    function ticked() {
                        link
                            .attr("x1", d => d.source.x)
                            .attr("y1", d => d.source.y)
                            .attr("x2", d => d.target.x)
                            .attr("y2", d => d.target.y);

                        node
                            .attr("x", d => d.x - 100 / 2)
                            .attr("y", d => d.y - 100 / 2);
                    }

                    // Reheat the simulation when drag starts, and fix the subject position.
                    function dragstarted(event) {
                        if (!event.active) simulation.alphaTarget(1).restart();
                        event.subject.fx = event.subject.x;
                        event.subject.fy = event.subject.y;
                    }

                    // Update the subject (dragged node) position during drag.
                    function dragged(event) {
                        event.subject.fx = event.x;
                        event.subject.fy = event.y;
                    }

                    // Restore the target alpha so the simulation cools after dragging ends.
                    // Unfix the subject position now that it’s no longer being dragged.
                    function dragended(event) {
                        if (!event.active) simulation.alphaTarget(0);
                        event.subject.fx = null;
                        event.subject.fy = null;
                    }

                    return svg.node();
                }
                document.getElementById("chart").appendChild(chart());
            </script>
        </body>
    </html>
    `;

    function renderTree(tree, i = 1) {
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
            if(whitelist) {
                let match = false;
                for(let ignore of whitelist) {
                    if(node.name.includes(ignore)) {
                        match = true;
                        break;
                    }
                }
                if(!match) continue loop;
            }
            if(ignoreComments) {
                link.comments = link.comments.filter(c => ignoreComments.indexOf(c) === -1);
            }
            if(removeText) {
                for(let textToRemove of removeText) {
                    link.text = link.text.replace(/\s+/g, ' ').replaceAll(textToRemove, '');
                }
            }
            html += `<div class="node" ${i === 1 ? `id="${node.name}"` : ''}><a class="name" href="${node.name}" target="_blank">${node.name}</a> ${i !== 1 ? `<a href="#${node.name}">[node]</a>` : ''}<br>` +
                `<span class="text">${link.text}</span><br>` +
                (link.authorComments && link.authorComments.length > 0 ? `<span class="author-comments">${link.authorComments.join('<br>')}</span><br>` : '') +
                (link.comments.length > 0 ? `<span class="comments">${link.comments.join('<br>')}</span><br>` : '') +
                (link.images.length > 0 ? `<span class="images">${link.images.map(i => `<a href="${i}" target="_blank"><img src="${i}"></a>`).join('')}</span><br>` : '');
            if(node.children.length) {
                html += `<div class="children">${renderTree(node.children, i+1)}</div>`;
            }
            html += '</div>';
        }
        return html;
    }

    fs.writeFileSync(outputFile, html);

    console.log(`Rendered ${file} to ${outputFile}`);
} else if(action === 'comment') {
    const url = argv._[1];
    const parsedUrl = URL.parse(url);
    const outputFile = argv.o || `${parsedUrl.hostname}.json`;

    if(!fs.existsSync(outputFile)) {
        return console.log(`File ${outputFile} does not exist`);
    }

    let data = JSON.parse(fs.readFileSync(outputFile));

    fs.writeFileSync(outputFile+'.prev', JSON.stringify(data));

    if(!data[url]) {
        return console.log(`No data for ${url}`);
    }

    if(!data[url].authorComments) {
        data[url].authorComments = [];
    }

    let comment = argv._.slice(2).join(' ');
    data[url].authorComments.push(comment);

    fs.writeFileSync(outputFile, JSON.stringify(data));

    console.log(`Added comment "${comment}" to ${url}`);
} else if(action === 'clean') {
    let file = argv._[1];
    if(!fs.existsSync(file)) {
        return console.log(`File ${file} does not exist`);
    }
    let text = argv._.slice(2).join(' ');

    let data = JSON.parse(fs.readFileSync(file));

    fs.writeFileSync(file+'.prev', JSON.stringify(data));

    let cleaned = 0;
    for(let url in data) {
        if(!data[url].text) continue;
        let toStart = text.startsWith('^');
        if(toStart) {
            text = text.slice(1);
        }
        if(data[url].text.replace(/\s+/g, ' ')[toStart ? 'startsWith' : 'includes'](text)) {
            delete data[url];
            cleaned++;
            for(let url2 in data) {
                if(data[url2].links) {
                    data[url2].links = data[url2].links.filter(l => l !== url);
                }
            }
        }
    }

    fs.writeFileSync(file, JSON.stringify(data));

    console.log(`Cleaned ${cleaned} links containing "${text}" from ${file}`);
} else if(action === 'restore' || action === 'undo' || action === 'revert' || action === 'prev' || action === 'reverse') {
    let file = argv._[1];
    if(!fs.existsSync(file+'.prev')) {
        return console.log(`File ${file}.prev does not exist`);
    }

    fs.copyFileSync(file+'.prev', file);

    console.log(`Restored ${file} from ${file}.prev`);
}