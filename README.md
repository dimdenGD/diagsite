# Diagsite
Command line program to crawl site and generate HTML file with diagram of pages.

```
Usage: node index.js <crawl/render> <url/file> [options]
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
```