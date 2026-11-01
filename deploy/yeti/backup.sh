#!/usr/bin/env bash
set -euo pipefail
umask 077
cd /home/jelastic/kittakat/current
export KITTAKAT_DB_PATH=/home/jelastic/kittakat/data/kittakat.sqlite
/opt/.nvm/versions/node/v24.22.2/bin/node /home/jelastic/kittakat/backup-server.mjs
/usr/sbin/logrotate -s /home/jelastic/kittakat/logrotate.status /home/jelastic/kittakat/logrotate.conf
