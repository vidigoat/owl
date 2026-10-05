#!/usr/bin/env bash
# Turn on the hosted live agent at second-set-of-hands.vercel.app/talk.html, with a hard ceiling.
#
#   AWS_PROFILE=<an admin profile> bash scripts/hosted-setup.sh          # asks before changing anything
#   AWS_PROFILE=<an admin profile> bash scripts/hosted-setup.sh --undo   # takes it all away again
#
# What it makes, and nothing else:
#   - a DynamoDB table `owl-spend`, provisioned at 1 read / 1 write — inside the always-free tier —
#     holding ONE item: what the hosted agent has spent, across every instance (mcp/shared-budget.js)
#   - an IAM user `owl-hosted` that can call Nova 2 Lite through Converse — the agent, and watching
#     a step through the camera — and read/update that one table. Not the laptop's user: revoking
#     the hosted agent never breaks local runs.
#   - its access key, piped straight into `vercel env add` for production — never printed, never on disk
#   - HANDS_LEDGER_TABLE, HANDS_BUDGET_USD (default 5) and AWS_REGION on Vercel, then a production deploy
#
# The deployment refuses to talk if the table is missing or unreachable (agent/live.js), so the
# order below cannot leave it spending without a ceiling.
set -euo pipefail

TABLE=owl-spend
USER_NAME=owl-hosted
REGION=us-east-1
CEILING="${HANDS_BUDGET_USD:-5}"
cd "$(dirname "$0")/.."

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)

if [[ "${1:-}" == "--undo" ]]; then
  for k in $(aws iam list-access-keys --user-name "$USER_NAME" --query 'AccessKeyMetadata[].AccessKeyId' --output text 2>/dev/null); do
    aws iam delete-access-key --user-name "$USER_NAME" --access-key-id "$k"
  done
  aws iam delete-user-policy --user-name "$USER_NAME" --policy-name owl-hosted 2>/dev/null || true
  aws iam delete-user --user-name "$USER_NAME" 2>/dev/null || true
  for v in AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY HANDS_LEDGER_TABLE HANDS_BUDGET_USD AWS_REGION; do
    vercel env rm "$v" production --yes 2>/dev/null || true
  done
  vercel --prod --yes >/dev/null
  echo "Hosted agent off: user and keys deleted, Vercel variables removed, redeployed."
  echo "The table $TABLE is kept as the record of what was spent; delete it with:"
  echo "  aws dynamodb delete-table --table-name $TABLE --region $REGION"
  exit 0
fi

cat <<EOF
This will, in AWS account $ACCOUNT:
  - create DynamoDB table $TABLE ($REGION, 1 RCU / 1 WCU — free tier)
  - create IAM user $USER_NAME: Converse on Nova 2 Lite, GetItem/UpdateItem on $TABLE, nothing else
  - give Vercel production its key, HANDS_LEDGER_TABLE=$TABLE, HANDS_BUDGET_USD=$CEILING
  - deploy
The most the hosted agent can ever spend, across every instance, is \$$CEILING.
The same table keeps the household (appliances and repairs) across sessions.
EOF
read -r -p "Go ahead? [y/N] " ok
[[ "$ok" == "y" || "$ok" == "Y" ]] || { echo "Nothing changed."; exit 1; }

if ! aws dynamodb describe-table --table-name "$TABLE" --region "$REGION" >/dev/null 2>&1; then
  aws dynamodb create-table --table-name "$TABLE" --region "$REGION" \
    --attribute-definitions AttributeName=id,AttributeType=S --key-schema AttributeName=id,KeyType=HASH \
    --provisioned-throughput ReadCapacityUnits=1,WriteCapacityUnits=1 >/dev/null
  aws dynamodb wait table-exists --table-name "$TABLE" --region "$REGION"
fi

aws iam get-user --user-name "$USER_NAME" >/dev/null 2>&1 || aws iam create-user --user-name "$USER_NAME" >/dev/null
aws iam put-user-policy --user-name "$USER_NAME" --policy-name owl-hosted --policy-document "$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": "bedrock:InvokeModel",
      "Resource": [
        "arn:aws:bedrock:*:$ACCOUNT:inference-profile/us.amazon.nova-2-lite-v1:0",
        "arn:aws:bedrock:*::foundation-model/amazon.nova-2-lite-v1:0"
      ] },
    { "Effect": "Allow", "Action": ["dynamodb:GetItem", "dynamodb:UpdateItem"],
      "Resource": "arn:aws:dynamodb:$REGION:$ACCOUNT:table/$TABLE" }
  ]
}
JSON
)"

# One key at a time: an old one is replaced, never left behind.
for k in $(aws iam list-access-keys --user-name "$USER_NAME" --query 'AccessKeyMetadata[].AccessKeyId' --output text); do
  aws iam delete-access-key --user-name "$USER_NAME" --access-key-id "$k"
done
KEY_JSON=$(aws iam create-access-key --user-name "$USER_NAME" --output json)

put() { vercel env rm "$1" production --yes >/dev/null 2>&1 || true; printf '%s' "$2" | vercel env add "$1" production >/dev/null; }
put AWS_ACCESS_KEY_ID "$(printf '%s' "$KEY_JSON" | node -pe 'JSON.parse(require("fs").readFileSync(0)).AccessKey.AccessKeyId')"
put AWS_SECRET_ACCESS_KEY "$(printf '%s' "$KEY_JSON" | node -pe 'JSON.parse(require("fs").readFileSync(0)).AccessKey.SecretAccessKey')"
unset KEY_JSON
put HANDS_LEDGER_TABLE "$TABLE"
put HANDS_BUDGET_USD "$CEILING"
put AWS_REGION "$REGION"

# A new IAM key takes a few seconds to be accepted everywhere.
sleep 10
vercel --prod --yes >/dev/null
echo "Hosted agent on, ceiling \$$CEILING for every instance together: https://second-set-of-hands.vercel.app/talk.html"
echo "What it has spent:  aws dynamodb get-item --table-name $TABLE --key '{\"id\":{\"S\":\"ledger\"}}' --region $REGION"
echo "Turn it off:        AWS_PROFILE=$AWS_PROFILE bash scripts/hosted-setup.sh --undo"
