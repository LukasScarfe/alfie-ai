"""Pictures: sanitising uploads and the folder store (pictures.py)."""
import pytest

from alfie.pictures import MAX_SHAPES, PictureError, PictureStore, picture_id, sanitise

LOGO = """<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 50" width="200">
  <title>Logo</title>
  <style>.cls-1{fill:#ff0000;stroke:none} .a, .b { stroke: blue }</style>
  <script>alert(1)</script>
  <defs><linearGradient id="g"/></defs>
  <g transform="translate(10 0)" onclick="evil()">
    <path class="cls-1" d="M0 0L10 0L10 10Z" onload="x()"/>
    <rect x="20" y="0" width="10" height="5" style="fill:url(#g);stroke:#00f" class="a"/>
    <text x="0" y="40">Hi</text>
    <image href="http://example.com/x.png"/>
    <a xlink:href="javascript:alert(1)"><circle cx="50" cy="25" r="5"/></a>
  </g>
</svg>"""


def test_sanitise_keeps_shapes_and_paint_drops_the_rest():
    out, info = sanitise(LOGO)
    assert info == {"shapes": 3, "view_box": "0 0 100 50"}
    for bad in ("script", "alert", "onclick", "onload", "text", "image", "defs", "href", "url(", "title", "style>"):
        assert bad not in out, bad
    assert 'viewBox="0 0 100 50"' in out and 'transform="translate(10 0)"' in out
    assert "fill:#ff0000" in out           # the class rule, folded in
    assert "stroke:#00f" in out and "stroke:blue" not in out   # inline style beats the class
    assert out.startswith("<svg") and 'xmlns="http://www.w3.org/2000/svg"' in out


@pytest.mark.parametrize("text, why", [
    ("", "empty"),
    ("<html><body/></html>", "root"),
    ("<svg><text>only words</text></svg>", "Nothing to draw"),
    ('<!DOCTYPE svg [<!ENTITY a "aaaa">]><svg><path d="M0 0"/></svg>', "DOCTYPE"),
    ("<svg><path d='M0 0'></svg", "readable"),
])
def test_sanitise_refuses(text, why):
    with pytest.raises(PictureError, match=why):
        sanitise(text)


def test_sanitise_caps_shapes():
    many = "<svg>" + '<path d="M0 0L1 1"/>' * (MAX_SHAPES + 1) + "</svg>"
    with pytest.raises(PictureError, match="detailed"):
        sanitise(many)


def test_picture_id():
    assert picture_id("My Logo (v2).svg", set()) == "my_logo_v2"
    assert picture_id("logo.svg", {"logo", "logo_2"}) == "logo_3"
    assert picture_id("!!!.svg", set()) == "picture"


def test_store_round_trip(tmp_path):
    st = PictureStore(str(tmp_path / "pictures"))
    assert st.list() == [] and st.rev()
    r0 = st.rev()
    meta = st.save("Garden plan.svg", LOGO)
    assert meta["id"] == "garden_plan" and meta["shapes"] == 3
    assert "script" not in st.read("garden_plan")
    [m] = st.list()
    assert m["name"] == "Garden plan" and m["rev"] == meta["rev"]
    assert st.rev() != r0
    st.rename("garden_plan", "Garden")
    assert st.list()[0]["name"] == "Garden"
    # Replacing keeps the id and the name it was given.
    again = st.save("Garden", '<svg viewBox="0 0 1 1"><circle r="1"/></svg>', "garden_plan")
    assert again["id"] == "garden_plan" and again["shapes"] == 1
    with pytest.raises(PictureError):
        st.save("x", LOGO, "nope")
    st.delete("garden_plan")
    assert st.list() == []
    with pytest.raises(PictureError):
        st.read("garden_plan")
    with pytest.raises(PictureError):
        st.read("../secrets")


def test_store_sanitises_hand_copied_files(tmp_path):
    root = tmp_path / "pictures"
    root.mkdir()
    (root / "dropped.svg").write_text('<svg><script>x</script><path d="M0 0L1 1"/></svg>')
    st = PictureStore(str(root))
    assert [m["id"] for m in st.list()] == ["dropped"]
    assert "script" not in st.read("dropped")
