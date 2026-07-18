# Minimal scheduled pg_dump image for the `backup` Compose service.
# ARCHITECTURE.md §8.1 / §8.3: daily pg_dump at 02:00 into a volume that is
# replicated off-host (church's existing NAS-replication practice).
FROM alpine:3.21

RUN apk add --no-cache postgresql16-client dcron tzdata

COPY backup.sh /usr/local/bin/backup.sh
COPY crontab /etc/crontabs/root
RUN chmod +x /usr/local/bin/backup.sh

VOLUME ["/backups"]

# dcron in foreground, logging to stdout (captured by Docker's log driver,
# consistent with the structured-logging approach in §9).
CMD ["crond", "-f", "-d", "8"]
