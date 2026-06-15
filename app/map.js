import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { useRouter } from 'expo-router';
import EmptyState from '../src/components/EmptyState';
import { useApp } from '../src/context/AppContext';
import { colors, categoryColor } from '../src/theme/theme';

const TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;

export default function MapScreen() {
  const router = useRouter();
  const { events, city } = useApp();

  const pts = useMemo(
    () =>
      events
        .filter((e) => typeof e.lat === 'number' && typeof e.lng === 'number')
        .map((e) => ({ id: e.id, title: e.title, lng: e.lng, lat: e.lat, color: categoryColor(e.category) })),
    [events]
  );

  if (!TOKEN) {
    return <EmptyState icon="map-outline" title="Map unavailable" body="The map needs a Mapbox token to load." />;
  }
  if (!pts.length) {
    return (
      <EmptyState
        icon="map-outline"
        title="No mapped events yet"
        body={`Events in ${city.name} show up on the map once their addresses are geocoded.`}
        accent={colors.primary}
      />
    );
  }

  const html = `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<link href="https://api.mapbox.com/mapbox-gl-js/v3.6.0/mapbox-gl.css" rel="stylesheet">
<script src="https://api.mapbox.com/mapbox-gl-js/v3.6.0/mapbox-gl.js"></script>
<style>body,html,#map{margin:0;padding:0;height:100%;width:100%}</style></head>
<body><div id="map"></div><script>
mapboxgl.accessToken=${JSON.stringify(TOKEN)};
var pts=${JSON.stringify(pts)};
var b=new mapboxgl.LngLatBounds();
pts.forEach(function(p){b.extend([p.lng,p.lat]);});
var map=new mapboxgl.Map({container:'map',style:'mapbox://styles/mapbox/streets-v12',bounds:b,fitBoundsOptions:{padding:60,maxZoom:14}});
map.addControl(new mapboxgl.NavigationControl(),'top-right');
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');}
pts.forEach(function(p){
  var el=document.createElement('div');
  el.style.cssText='width:18px;height:18px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);cursor:pointer;background:'+p.color;
  var html='<div style="font:14px -apple-system,sans-serif;max-width:190px"><b>'+esc(p.title)+'</b><br>'
    +'<a href="#" onclick="window.ReactNativeWebView.postMessage(\\''+p.id+'\\');return false;" style="color:#1F6F54;font-weight:600">View details &rsaquo;</a></div>';
  new mapboxgl.Marker(el).setLngLat([p.lng,p.lat]).setPopup(new mapboxgl.Popup({offset:14}).setHTML(html)).addTo(map);
});
</script></body></html>`;

  return (
    <View style={styles.screen}>
      <WebView
        originWhitelist={['*']}
        source={{ html }}
        onMessage={(e) => {
          const id = e.nativeEvent.data;
          if (id) router.push(`/event/${id}`);
        }}
        style={{ flex: 1 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
});
