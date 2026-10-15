#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Exercises every agepass subcommand against the local devnet.
set -euo pipefail
cd /home/user/AgePass
export AGEPASS_NETWORK=undeployed
export AGEPASS_PRIVATE_STATE_PASSWORD='Smoke-Test-Lantern-42x'
W=/tmp/claude-0/smoke; rm -rf $W .agepass/deployment.undeployed.json; mkdir -p $W
A() { npm run -s agepass -w @agepass/cli -- "$@"; }
A deploy
A issuer init | tee $W/issuer.txt
IPK=$(grep -oE '[0-9a-f]{64}' $W/issuer.txt | tail -1)
A admin add-issuer "$IPK"
A holder init --name ada | tee $W/holder.txt
HPK=$(grep -oE '[0-9a-f]{64}' $W/holder.txt | tail -1)
[ "$(A holder show-pk --name ada | tail -1)" = "$HPK" ]
A issuer issue --birth-date 1998-04-12 --expires 2031-12-31 --holder-pk "$HPK" --issuer-name "Demo KYC Ltd" -o $W/receipt.json
A holder import-credential $W/receipt.json --name ada
A site challenge --domain cornercellar.example --min-age 18 --site-name "Corner Cellar" -o $W/ch.json
A site check --challenge $W/ch.json
A holder prove --challenge $W/ch.json --name ada
A site check --challenge $W/ch.json
A ledger
echo SMOKE-OK
