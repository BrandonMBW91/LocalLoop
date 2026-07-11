// #8 Home-screen widget — "This weekend in {town}". WidgetKit (Swift). STAGED:
// not yet wired into the build (see targets/widget/README.md). Reads the next few
// events from the App Group container that the RN app writes on refresh, so the
// widget shows real data with no network of its own.
import WidgetKit
import SwiftUI

// One event row the RN app writes into the shared container.
struct LLEvent: Codable {
  let title: String
  let day: String     // e.g. "Sat 2:00 PM"
  let venue: String
}

struct LLData: Codable {
  let town: String
  let events: [LLEvent]
  let updated: String
}

// App Group id — must match the entitlement on BOTH the app and this target.
let APP_GROUP = "group.com.michaelwilliams.localloop"

func loadData() -> LLData {
  let fallback = LLData(town: "your town", events: [], updated: "")
  guard let defaults = UserDefaults(suiteName: APP_GROUP),
        let raw = defaults.string(forKey: "widgetData"),
        let data = raw.data(using: .utf8),
        let decoded = try? JSONDecoder().decode(LLData.self, from: data)
  else { return fallback }
  return decoded
}

struct Provider: TimelineProvider {
  func placeholder(in context: Context) -> Entry { Entry(date: Date(), data: loadData()) }
  func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
    completion(Entry(date: Date(), data: loadData()))
  }
  func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
    // Refresh a few times a day; the RN app also rewrites data on open.
    let entry = Entry(date: Date(), data: loadData())
    let next = Calendar.current.date(byAdding: .hour, value: 6, to: Date())!
    completion(Timeline(entries: [entry], policy: .after(next)))
  }
}

struct Entry: TimelineEntry {
  let date: Date
  let data: LLData
}

struct LocalLoopWidgetEntryView: View {
  var entry: Entry
  let navy = Color(red: 0.082, green: 0.192, blue: 0.357)

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text("This weekend in \(entry.data.town)")
        .font(.caption).bold().foregroundColor(navy)
      if entry.data.events.isEmpty {
        Text("Open Local Loop to see what's on")
          .font(.caption2).foregroundColor(.secondary)
      } else {
        ForEach(entry.data.events.prefix(3), id: \.title) { ev in
          VStack(alignment: .leading, spacing: 1) {
            Text(ev.title).font(.caption2).bold().lineLimit(1)
            Text("\(ev.day) · \(ev.venue)").font(.system(size: 10)).foregroundColor(.secondary).lineLimit(1)
          }
        }
      }
      Spacer(minLength: 0)
    }
    .padding(12)
    .widgetURL(URL(string: "localloop://"))
  }
}

@main
struct LocalLoopWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "LocalLoopWidget", provider: Provider()) { entry in
      LocalLoopWidgetEntryView(entry: entry)
    }
    .configurationDisplayName("Local Loop")
    .description("This weekend's events in your town.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}
