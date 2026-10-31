import pytest

from alfie import brain, wiki

EN = brain.load_language("en")

PAGE = """<html><head><title>Paris</title><style>.x{}</style></head><body>
<h1>Paris</h1>
<div class="hatnote">For other uses, see Paris (disambiguation).</div>
<p class="mw-empty-elt"> </p>
<table class="infobox"><tr><td><p>Capital city of France</p></td></tr></table>
<p><b>Paris</b> (French pronunciation: [pa.ʁi] <span>(listen)</span>) is the capital of
France, with an area of 105.4 km<sup>2</sup>.<sup class="reference">[1]</sup> It lies on the
Seine. St. Denis is nearby.</p>
<p>The city is a major centre of finance.</p>
<h2>Etymology</h2><p>Never read.</p></body></html>"""

DISAMB = """<html><head><title>Mercury</title></head><body>
<p><b>Mercury</b> most commonly refers to:</p><ul><li>Mercury (planet)</li></ul></body></html>"""


def test_reads_the_lead():
    title, paras, disamb = wiki.read_lead(PAGE)
    assert title == "Paris" and not disamb
    assert len(paras) == 2 and "Never read" not in " ".join(paras)
    assert "Capital city" not in paras[0] and "[1]" not in paras[0]


def test_lead_reply():
    _t, paras, _d = wiki.read_lead(PAGE)
    assert wiki.lead_reply(paras, 1) == \
        "Paris is the capital of France, with an area of 105.4 km2."
    assert wiki.lead_reply(paras, 3) == ("Paris is the capital of France, with an area of "
                                         "105.4 km2. It lies on the Seine. St. Denis is nearby.")
    assert wiki.lead_reply(paras, 1, brackets=True).startswith(
        "Paris (French pronunciation: [pa.ʁi] (listen)) is")
    assert wiki.lead_reply([], 2) is None


def test_disambiguation():
    assert wiki.read_lead(DISAMB)[2]


def test_sentences_keep_abbreviations():
    assert wiki.sentences("J. R. R. Tolkien was a writer. He wrote books. More.", 2) == \
        "J. R. R. Tolkien was a writer. He wrote books."
    assert wiki.sentences("It is in the U.S. state of Ohio. Next one.", 1) == \
        "It is in the U.S. state of Ohio."
    assert wiki.sentences("Built c. 1900 by them. Then.", 1) == "Built c. 1900 by them."


@pytest.mark.parametrize("name,titles", [
    ("albert einstein", ["Albert einstein", "Albert Einstein"]),
    ("a cat", ["Cat", "CAT"]),
    ("the beatles?", ["The beatles", "The Beatles", "Beatles"]),
    ("nasa", ["Nasa", "NASA"])])
def test_titles(name, titles):
    assert wiki.titles_for(name) == titles


def test_path():
    assert wiki.path_of("wp", "Albert Einstein") == "/content/wp/Albert_Einstein"
    assert wiki.path_of("wp", "AC/DC") == "/content/wp/AC/DC"


def test_book():
    cat = '<link href="/content/gutenberg_en/x"/><link href="/content/wikipedia_en_all_nopic_2026-06"/>'
    assert wiki.book_of(cat) == "wikipedia_en_all_nopic_2026-06"
    assert wiki.book_of(cat, "gutenberg") == "gutenberg_en"
    assert wiki.book_of(cat, "nope") is None
    assert wiki.book_of("") is None


@pytest.mark.parametrize("name,ok", [
    ("albert einstein", True), ("the beatles", True), ("my name", False), ("it", False),
    ("going on", False), ("the time", False), ("?", False)])
def test_asks_about(name, ok):
    assert wiki.asks_about(name, EN) is ok


hassil = pytest.importorskip("hassil")
INTENTS = hassil.Intents.from_dict(brain.own_intents(EN, brain.default_settings(), "en"))


@pytest.mark.parametrize("text,topic", [
    ("who was albert einstein", "albert einstein"),
    ("what is a quasar", "a quasar"),
    ("where is timbuktu", "timbuktu"),
    ("tell me about vancouver", "vancouver"),
    ("what do you know about the beatles", "the beatles")])
def test_sentences(text, topic):
    got = [(brain.command_of(r.intent.name), {k: str(v.value).strip() for k, v in r.entities.items()})
           for r in hassil.recognize_all(text, INTENTS)]
    assert ("wiki", {"topic": topic}) in got, got
