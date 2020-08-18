FROM node:12.18.3-stretch
ENV HOME=/home/node
ENV APP_HOME=/home/node/rendering-srv
## SETTING UP THE APP ##
RUN mkdir $APP_HOME
WORKDIR $APP_HOME
RUN cd $APP_HOME
# Bundle app source
COPY . $APP_HOME
# Chown all the files to the node user.
RUN chown -R node:node $HOME
RUN pwd
# switch to the node user.
USER node
RUN npm install
RUN npm run build
EXPOSE 50051
HEALTHCHECK CMD npm run healthcheck
CMD [ "npm", "start" ]
