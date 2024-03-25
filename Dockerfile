FROM denoland/deno:1.41.3

# The port that your application listens to.
EXPOSE 80

WORKDIR /app
ADD . /app

ENV MODE=production

RUN apt-get update
RUN apt-get install -y ca-certificates
ADD prod-ca-2021.crt /usr/local/share/ca-certificates/prod-ca-2021.crt
RUN chmod 644 /usr/local/share/ca-certificates/prod-ca-2021.crt && update-ca-certificates

RUN deno cache backend/index.ts

CMD ["run", "--allow-all", "--env=.env", "backend/index.ts"]
