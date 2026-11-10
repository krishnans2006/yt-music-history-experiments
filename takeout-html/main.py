from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, urlparse


class HistoryParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.divs = []
        self.total = 0
        self.video_ids = set()
        self.header = []
        self.content = []
        self.url = ""

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "div":
            classes = attrs.get("class", "").split()
            if "outer-cell" in classes:
                self.header = []
                self.content = []
                self.url = ""
                kind = "entry"
            elif "header-cell" in classes:
                kind = "header"
            elif "content-cell" in classes and "mdl-typography--body-1" in classes:
                kind = "content" if "mdl-typography--text-right" not in classes else None
            else:
                kind = None
            self.divs.append(kind)
        elif tag == "a" and "content" in self.divs and not self.url:
            self.url = attrs.get("href", "")
        elif tag == "br":
            self.handle_data(" ")

    def handle_data(self, data):
        if "header" in self.divs:
            self.header.append(data)
        elif "content" in self.divs:
            self.content.append(data)

    def handle_endtag(self, tag):
        if tag != "div" or not self.divs:
            return
        if self.divs.pop() == "entry":
            header = " ".join("".join(self.header).split())
            content = " ".join("".join(self.content).split())
            if header == "YouTube Music" and content.startswith("Watched "):
                self.total += 1
                self.video_ids.update(parse_qs(urlparse(self.url).query).get("v", []))


if __name__ == "__main__":
    files = Path(__file__).resolve().parents[1] / "media"
    for path in sorted(files.glob("*.html")):
        parser = HistoryParser()
        with path.open(encoding="utf-8") as file:
            for chunk in iter(lambda: file.read(65536), ""):
                parser.feed(chunk)
        parser.close()
        print(f"{path.name}:")
        print(f"  YouTube Music listens: {parser.total:,}")
        print(f"  Unique videos with IDs: {len(parser.video_ids):,}")
