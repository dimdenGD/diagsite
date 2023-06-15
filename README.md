# Diagsite
Command line program to crawl site and generate HTML file with diagram of pages.

```
Usage: node index.js [params] [options]

Params:
    crawl   <url>           Crawls given URL and saves diagram data to file
    render  <file>          Renders diagram from file
    comment <url> <comment> Adds comment to URL in file
    clean   <file> <text>   Removes all urls containing given text from file

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
    -d                  Debug mode
    -h                  Prints this help message
```