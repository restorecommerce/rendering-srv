#!/bin/bash

SERVICE_NAME="rendering-srv"

DOCKER_BUILDKIT=1 docker build \
  --tag restorecommerce/$SERVICE_NAME \
  -f ./Dockerfile \
  --cache-from restorecommerce/$SERVICE_NAME \
  --build-arg APP_HOME=/home/node/$SERVICE_NAME \
  .
