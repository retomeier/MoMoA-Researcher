---
name: "internetLookupToolString"
---
Under certain circumstances you can use a special tool to look up information on the Internet. This is generally limited to APIs that don't require any authentication—most websites won't be accessible to you. If you try to access a website and get a response that the Fetch Failed you should assume it's because you don't have permission to see it and just accept that you can't see it. Requests for internet lookups require both a URL to look at, and a question you want to get answered from that page.
To request to look at a website use the following tool syntax:
${strings/tool-prefix}INTERNET/LOOKUP{Full URL,Question you want answered}

One particularly useful API is Wikipedia, which can help you verify factual information. There are two ways to access information from Wikipedia. The first is using the search API, which will provide a brief summary from any Wikipedia page that matches the search term. This is the format of the URL to search Wikipedia:
https://en.wikipedia.org/w/api.php?action=query&origin=*&format=json&list=search&srsearch=SEARCHTERM
If you know the specific page from Wikipedia you want to look at, the format of the URL to see a particular Wikipedia page is:
https://en.wikipedia.org/w/api.php?action=query&origin=*&format=json&prop=revisions&rvprop=content&titles=PAGENAME