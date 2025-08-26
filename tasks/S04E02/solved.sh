#! /bin/bash

# Manually check verify strings on https://platform.openai.com/chat/edit?models=ft%3Agpt-4.1-mini-2025-04-14%3Apersonal%3Adevs01%3AC8wM3Fwg

curl -X POST "https://c3ntrala.ag3nts.org/report" \
  -H "Content-Type: application/json" \
  -d '{
    "task":"research",
    "apikey":"nope",
    "answer":["03","08","10"]
  }'
