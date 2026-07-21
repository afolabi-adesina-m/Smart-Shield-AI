from Live_weather import fetch_current_weather
print(fetch_current_weather(43.6532, -79.3832))   # Toronto

from Live_alerts import fetch_all_events
events = fetch_all_events()
print(events[:2] if events else events)
