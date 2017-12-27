FROM node:9.2.0-wheezy

# Create app directory
RUN mkdir -p /usr/share/rendering-srv
RUN mkdir -p /root/.ssh
WORKDIR /usr/share/rendering-srv

# Set config volumes
VOLUME /usr/share/rendering-srv/cfg
VOLUME /usr/share/rendering-srv/protos

# Bundle app source
COPY . /usr/share/rendering-srv

# Install app dependencies
RUN npm install -g typescript

RUN cd /usr/share/rendering-srv
COPY id_rsa /root/.ssh/
COPY config /root/.ssh/
COPY known_hosts /root/.ssh/

RUN npm install
RUN npm run postinstall

EXPOSE 50051
CMD [ "npm", "start" ]

# To build the image:
# docker build -t restorecommerce/rendering-srv .
#
# To create a container:
# docker create --name rendering-srv -v <absolute_path_to_cfg>/:/usr/share/rendering-srv/cfg --net restorecommercedev_default restorecommerce/rendering
#
# docker create --name rendering-srv --net restorecms_default restorecommerce/rendering-srv
#
# To run the container:
# docker start rendering-srv
