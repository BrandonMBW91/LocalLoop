import React, { useMemo, useRef, useCallback, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import EmptyState from '../src/components/EmptyState';
import { useApp } from '../src/context/AppContext';
import { fetchEventsInBounds } from '../src/lib/db';
import { colors, categoryColor } from '../src/theme/theme';

// Web build of the Events Map. The native screen (app/map.js) renders the Mapbox
// page inside a react-native-webview, which has no web implementation and threw
// "React Native WebView does not support this platform." on localloop.io. Metro
// picks THIS .web.js file on web, and we render the identical Mapbox page in a
// real <iframe> instead. Messaging switches from ReactNativeWebView.postMessage
// to window.postMessage between the iframe and this parent.
const TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
const MAX_PINS = 600; // hard cap so a fully zoomed-out map can't drown the map

export default function MapScreenWeb() {
  const router = useRouter();
  const { events, city, backendEnabled } = useApp();
  const frameRef = useRef(null);
  const sentIds = useRef(new Set()); // pins already on the map (seeded below)
  const inflight = useRef(false);

  const pts = useMemo(
    () =>
      events
        .filter((e) => typeof e.lat === 'number' && typeof e.lng === 'number')
        .map((e) => ({ id: e.id, title: e.title, lng: e.lng, lat: e.lat, color: categoryColor(e.category) })),
    [events]
  );
  sentIds.current = new Set(pts.map((p) => p.id));

  // The iframe reports its viewport after every pan/zoom; we fetch whatever
  // events live in that box (ANY town) and stream the new ones in — same as the
  // native screen, but pins go in via postMessage instead of injectJavaScript.
  const onMoved = useCallback(
    async (bbox) => {
      if (!backendEnabled || inflight.current || sentIds.current.size >= MAX_PINS) return;
      inflight.current = true;
      try {
        const rows = await fetchEventsInBounds(bbox);
        const fresh = rows
          .filter((r) => !sentIds.current.has(r.id))
          .slice(0, Math.max(0, MAX_PINS - sentIds.current.size))
          .map((r) => ({ id: r.id, title: r.title, lng: r.lng, lat: r.lat, color: categoryColor(r.category) }));
        if (fresh.length && frameRef.current && frameRef.current.contentWindow) {
          fresh.forEach((p) => sentIds.current.add(p.id));
          frameRef.current.contentWindow.postMessage(JSON.stringify({ type: 'addPts', pts: fresh }), '*');
        }
      } finally {
        inflight.current = false;
      }
    },
    [backendEnabled]
  );

  // Inbound messages from the iframe: viewport reports and pin taps. Only trust
  // strings shaped like our own protocol so a stray page/extension message can't
  // trigger navigation.
  useEffect(() => {
    const handler = (e) => {
      const data = e && e.data;
      if (typeof data !== 'string') return;
      if (data.startsWith('{')) {
        try {
          const msg = JSON.parse(data);
          if (msg.type === 'bbox') onMoved(msg);
        } catch { /* ignore malformed */ }
      } else if (/^[A-Za-z0-9-]{6,}$/.test(data)) {
        router.push(`/event/${data}`);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onMoved, router]);

  if (!TOKEN) {
    return <EmptyState icon="map-outline" title="Map unavailable" body="The map needs a Mapbox token to load." />;
  }
  if (!pts.length) {
    return (
      <EmptyState
        icon="map-outline"
        title="No mapped events yet"
        body={`Events in ${city.name} show up on the map once we know their exact address.`}
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
// Talk to whichever host is wrapping us: the native WebView or, on web, the parent window.
function send(m){ if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(m);} else if(window.parent){window.parent.postMessage(m,'*');} }
mapboxgl.accessToken=${JSON.stringify(TOKEN)};
var pts=${JSON.stringify(pts)};
var seen={};
var b=new mapboxgl.LngLatBounds();
pts.forEach(function(p){b.extend([p.lng,p.lat]);});
var map=new mapboxgl.Map({container:'map',style:'mapbox://styles/mapbox/streets-v12',bounds:b,fitBoundsOptions:{padding:60,maxZoom:14}});
map.addControl(new mapboxgl.NavigationControl(),'top-right');
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');}
function addMarker(p){
  if(seen[p.id])return; seen[p.id]=1;
  var el=document.createElement('div');
  el.style.cssText='width:40px;height:40px;display:flex;align-items:center;justify-content:center;cursor:pointer';
  var dot=document.createElement('div');
  dot.style.cssText='width:24px;height:24px;border-radius:50%;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45);background:'+p.color;
  el.appendChild(dot);
  var html='<div style="font:16px -apple-system,sans-serif;max-width:220px;padding:2px 0"><b>'+esc(p.title)+'</b><br>'
    +'<a href="#" onclick="send(\\''+p.id+'\\');return false;" style="display:inline-block;margin-top:6px;color:#15315B;font-weight:700;font-size:16px">View details &rsaquo;</a></div>';
  new mapboxgl.Marker(el).setLngLat([p.lng,p.lat]).setPopup(new mapboxgl.Popup({offset:18}).setHTML(html)).addTo(map);
}
pts.forEach(addMarker);
// Streamed in from the app as the user pans/zooms (other towns' events).
window.addPts=function(list){(list||[]).forEach(addMarker);};
// On web the app can't injectJavaScript, so it posts pins in as a message.
window.addEventListener('message',function(e){
  var d=e&&e.data; if(typeof d!=='string'||d[0]!=='{')return;
  try{var j=JSON.parse(d); if(j&&j.type==='addPts'){window.addPts(j.pts);}}catch(_){}
});
// Report the viewport after movement settles so the app can fetch what's visible.
var bboxTimer=null;
map.on('moveend',function(){
  clearTimeout(bboxTimer);
  bboxTimer=setTimeout(function(){
    var vb=map.getBounds();
    send(JSON.stringify({type:'bbox',w:vb.getWest(),s:vb.getSouth(),e:vb.getEast(),n:vb.getNorth()}));
  },350);
});
</script></body></html>`;

  return (
    <View style={styles.screen}>
      <iframe
        ref={frameRef}
        srcDoc={html}
        title="Events map"
        style={{ border: 0, width: '100%', height: '100%', flex: 1 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
});
