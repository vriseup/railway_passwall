FROM node:alpine3.22

WORKDIR /tmp

COPY index.js package.json ./

RUN apk update && apk upgrade &&\
    apk add --no-cache openssl curl gcompat iproute2 coreutils &&\
    apk add --no-cache bash &&\
    chmod +x index.js &&\
    npm install --omit=dev

CMD ["node", "index.js"]
