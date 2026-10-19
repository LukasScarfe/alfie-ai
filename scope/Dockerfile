# alfie-scope: Alfie's card, headless, feeding xy-bench's oscilloscope.
# The same Chromium + puppeteer image ./dev uses for screenshots.
FROM zenika/alpine-chrome:124-with-puppeteer
WORKDIR /usr/src/app
RUN npm install --no-audit --no-fund home-assistant-js-websocket@9.4.0 @mdi/svg@7.4.47
COPY mdi.js ./
RUN node mdi.js && rm -rf node_modules/@mdi
COPY bridge.js page.html ./
ENV HOME=/tmp
ENTRYPOINT ["node", "bridge.js"]
