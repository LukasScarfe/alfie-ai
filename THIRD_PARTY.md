# Third-party material

## d3-celestial: constellation figures

`custom_components/alfie/frontend/alfie-constellations.json` holds the stick figures of 23
well-known constellations (J2000 right ascension, declination and magnitude of each vertex). They
come from the constellation line data of [d3-celestial](https://github.com/ofrohn/d3-celestial)
by Olaf Frohn, with faint stars trimmed off the ends of the lines and the Great Bear cut down to
the Plough. d3-celestial is released under the BSD 3-Clause licence:

```
Copyright (c) 2015, Olaf Frohn
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted 
provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions 
and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of 
conditions and the following disclaimer in the documentation and/or other materials provided with 
the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to 
endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR 
IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND 
FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR 
CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL 
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, 
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, 
WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY 
WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.```

## Schlyter's planetary formulas

`frontend/alfie-sky.js` implements the low-precision formulas from Paul Schlyter's "How to compute
planetary positions" (stjarnhimlen.se), via xy-bench's `sky.py`. They are published mathematics,
not code, and are credited here out of courtesy.

## Material Design Icons: dev fixtures

`devenv/icons.json` holds the SVG paths of ten
[Material Design Icons](https://pictogrammers.com/library/mdi/) (Pictogrammers), so the tests
and the card harness can draw icons without Home Assistant. They are released under the Apache
License 2.0. In Home Assistant, Alfie takes every icon from HA's own icon set and bundles none.
