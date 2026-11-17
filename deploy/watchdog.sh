#!/bin/sh
# Emails the team if the app or the website stops answering, and again when it's back.
# Runs in the "watchdog" container (see docker-compose.yml).
apk add --no-cache curl >/dev/null
send() {
  [ -z "$RESEND_API_KEY" ] && return
  printf '{"from":"Morning Telos <meet@morningtelos.com>","to":["%s"],"subject":"[Morning Telos alert] %s","text":"%s. Checked from the server every minute."}' "$ALERT_EMAIL" "$1" "$1" |
    curl -s -m 15 https://api.resend.com/emails -H "Authorization: Bearer $RESEND_API_KEY" -H "Content-Type: application/json" --data-binary @- >/dev/null
}
sleep 240
af=0; ad=0; wf=0; wd=0
while true; do
  if curl -fs -m 10 -o /dev/null http://app:3000/healthz; then
    [ $ad = 1 ] && send "The app is back up"; af=0; ad=0
  else
    af=$((af+1)); [ $af -ge 3 ] && [ $ad = 0 ] && { send "chat.morningtelos.com is down"; ad=1; }
  fi
  if curl -fs -m 10 -o /dev/null http://web/; then
    [ $wd = 1 ] && send "The website is back up"; wf=0; wd=0
  else
    wf=$((wf+1)); [ $wf -ge 3 ] && [ $wd = 0 ] && { send "morningtelos.com is down"; wd=1; }
  fi
  sleep 60
done
