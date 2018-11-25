#!/usr/bin/env bash

trap 'kill %1; kill %2; kill %3; kill %4;' SIGINT
export ENVIRONMENT=test
export HOST=127.0.0.1
PORT=8081 node index.js & PORT=8082 node index.js & PORT=8083 node index.js & PORT=8084 node index.js & PORT=8085 node index.js
