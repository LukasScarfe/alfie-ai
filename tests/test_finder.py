from alfie.finder import Entry, Index, result, words

HOUSE = Index([
    Entry("switch.dining_coffee_maker_outlet", "Coffee maker",
          ("coffee machine", "espresso machine", "espresso maker"), "dining-coffee_maker-outlet",
          "Dining", True),
    Entry("sensor.dining_coffee_maker_outlet_power", "Coffee maker power", (),
          "dining-coffee_maker-outlet", "Dining", False),
    Entry("light.kitchen_lights", "Kitchen lights", ("kitchen light",), "", "Kitchen", True),
    Entry("sensor.filament_temp", "Office temperature", ("3D printer temperature",),
          "office-filament", "Office", True),
    Entry("sensor.filament_humidity", "Filament box humidity", ("office humidity",),
          "office-filament", "Office", True),
    Entry("sensor.raccoon_cpu", "Server CPU temperature", ("raccoon temperature",), "raccoon", "", False),
    Entry("switch.bedroom_michelle_office_outlet", "Michelle's office outlet",
          ("Michelle's desk",), "", "Bedroom", True),
])


def top(q, **kw):
    hits = HOUSE.search(q, **kw)
    return hits[0][1].entity_id if hits else None


def test_words_fold_plurals_and_apostrophes():
    assert words("The Kitchen LIGHTS") == ["the", "kitchen", "light"]
    assert words("Michelle's desk") == ["michelle", "desk"]
    assert words("glass") == ["glass"]


def test_an_alias_finds_its_entity():
    assert top("espresso machine") == "switch.dining_coffee_maker_outlet"
    assert top("the coffee maker") == "switch.dining_coffee_maker_outlet"
    assert top("Michelle's desk") == "switch.bedroom_michelle_office_outlet"


def test_more_words_pick_the_more_specific_entity():
    assert top("coffee maker power") == "sensor.dining_coffee_maker_outlet_power"


def test_a_room_with_a_kind_finds_the_sensor_there():
    assert top("office humidity") == "sensor.filament_humidity"
    assert top("temperature in the office") == "sensor.filament_temp"


def test_unexposed_entities_are_found_too():
    assert top("server temperature") == "sensor.raccoon_cpu"


def test_a_domain_narrows_the_search():
    assert top("coffee maker", domains=["sensor"]) == "sensor.dining_coffee_maker_outlet_power"


def test_nothing_like_it_finds_nothing():
    assert HOUSE.search("hot tub") == []
    assert HOUSE.search("the") == []


def test_best_needs_a_clear_winner():
    assert HOUSE.best("espresso maker").entity_id == "switch.dining_coffee_maker_outlet"
    assert HOUSE.best("hot tub") is None


def test_mentioned_finds_whole_names_longest_first():
    assert HOUSE.mentioned("Is the espresso maker on?") == ["switch.dining_coffee_maker_outlet"]
    # "kitchen light" is a whole alias; no other entity hides inside it.
    assert HOUSE.mentioned("turn on the kitchen lights") == ["light.kitchen_lights"]
    # Unexposed entities are only found on request.
    assert HOUSE.mentioned("raccoon temperature") == []
    assert HOUSE.mentioned("raccoon temperature", exposed_only=False) == ["sensor.raccoon_cpu"]


def test_result_reads_states_and_says_what_can_be_switched():
    hits = HOUSE.search("coffee maker")
    states = {"switch.dining_coffee_maker_outlet": ("off", ""),
              "sensor.dining_coffee_maker_outlet_power": ("0", "W")}
    r = result(hits, states.get)
    first = r["results"][0]
    assert first == {"entity_id": "switch.dining_coffee_maker_outlet", "name": "Coffee maker",
                     "state": "off", "area": "Dining",
                     "aliases": ["coffee machine", "espresso machine", "espresso maker"],
                     "can_control": True}
    power = next(x for x in r["results"] if x["entity_id"].startswith("sensor."))
    assert power["unit"] == "W" and power["can_control"] is False
    assert result([], states.get)["results"] == []
