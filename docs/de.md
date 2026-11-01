# Z-Wave JS UI

Steuern Sie Ihr Z-Wave-Netz in Gladys über
[Z-Wave JS UI](https://zwave-js.github.io/zwave-js-ui/) und einen MQTT-Broker.

Diese Integration spricht **nicht** direkt mit Ihrem Z-Wave-Stick. Z-Wave JS UI
verwaltet die Funkverbindung und das Netz; diese Integration macht aus den
Knoten, die es veröffentlicht, Gladys-Geräte und aus Gladys-Befehlen
Z-Wave-Befehle. Außerdem leitet sie einige Netzoperationen an Z-Wave JS UI
weiter (Inklusion, Exklusion, Neuaufbau der Routen), ausgelöst über die Szenen
und das Widget „Z-Wave-Netz“.

## Voraussetzungen

1. **Z-Wave JS UI**, gestartet und bereits mit Ihrem Z-Wave-Controller
   verbunden.
2. **Ein MQTT-Broker** (Mosquitto, EMQX…), der sowohl von Z-Wave JS UI als auch
   von Gladys aus erreichbar ist.

## Z-Wave JS UI einrichten

Die Integration erwartet MQTT-Topics mit einer ganz bestimmten Benennung. Diese
lässt sich auf der Gladys-Seite nicht einstellen: Z-Wave JS UI muss sich daran
anpassen.

In **Settings**, Abschnitt **MQTT**:

- **Name**: `zwave-js-ui` — sonst ist das Präfix einiger Topics falsch;
- **Prefix**: `zwave`;
- **Host url** / **Port**: Ihr Broker, dazu Benutzername und Passwort, falls er
  sie verlangt.

![Abschnitt MQTT](./images/zwavejs-ui-mqtt-configuration.jpg)

Dann im Abschnitt **Gateway** genau diese Einstellungen:

- **Topic type**: `Named topics`;
- **Payload type**: `Entire Z-Wave value Object`;
- **Send Z-Wave events**: aktiviert;
- **Include Node info**: aktiviert;
- **Publish node details**: aktiviert;
- **Ignore location** und **Ignore status updates**: deaktiviert.

![Abschnitt Gateway](./images/zwavejs-ui-gateway-configuration.jpg)

Ohne den Payload-Typ und die Z-Wave-Ereignisse erreicht kein Gerätezustand
Gladys.

## Integration konfigurieren

Öffnen Sie in Gladys den Tab **Konfiguration** der Integration:

1. **URL des MQTT-Brokers** — zum Beispiel `mqtt://192.168.1.10:1883`.
2. **MQTT-Benutzer / MQTT-Passwort** — bei einem anonymen Broker leer lassen.
3. Speichern Sie.

Mit **Verbindung testen** prüfen Sie die Verbindung: Es wird der erreichte
Broker angezeigt und wie viele Z-Wave-Knoten sichtbar sind.

## Geräte hinzufügen

Öffnen Sie den Tab **Entdecken**: Jeder nicht virtuelle Z-Wave-Knoten erscheint
dort mit den Funktionen, die diese Integration versteht. Wählen Sie einen Raum,
passen Sie den Namen an und erstellen Sie die gewünschten Geräte. **Scannen**
fragt bei Z-Wave JS UI eine aktuelle Knotenliste ab — praktisch direkt nach der
Inklusion eines neuen Geräts.

Ein neu erstelltes Gerät wird sofort mit den zuletzt bekannten Werten befüllt
und bleibt also nicht leer, während es auf das Aufwachen eines
batteriebetriebenen Sensors wartet.

## Unterstützte Geräte

Die Funktionen werden aus den Z-Wave-Command-Classes abgeleitet, die ein Knoten
bereitstellt:

| Command class                     | Was Sie in Gladys erhalten                                       |
| --------------------------------- | ---------------------------------------------------------------- |
| Binary Switch                     | Ein/Aus-Schalter                                                 |
| Multilevel Switch (Dimmer)        | Helligkeit, Ein/Aus, „vorherigen Zustand wiederherstellen“       |
| Multilevel Switch (Rollladen)     | Rollladenposition, öffnen/schließen/stoppen                      |
| Multilevel Switch (Steuerleitung) | Heizmodus: Aus, Frostschutz, Öko, Komfort…                       |
| Binary Sensor / Alarm Sensor      | Bewegung, Rauch, CO, CO₂, Leck, Öffnung, Temperatur              |
| Notification                      | Tür-/Fensteröffnung, Rauchalarm, CO-Alarm                        |
| Multilevel Sensor                 | Temperatur, Helligkeit, Leistung                                 |
| Meter                             | Energie, Leistung, Spannung, Stromstärke                         |
| Central Scene                     | Tastendrücke (einfach, doppelt, dreifach, gehalten, losgelassen) |
| Battery                           | Ladestand und Anzeige für schwache Batterie                      |
| Thermostat Mode                   | Modus: Aus, Heizen, Kühlen, Automatisch                          |
| Thermostat Setpoint               | Sollwerte für Heizen, Kühlen und Energiesparen                   |
| Thermostat Operating State        | was er tatsächlich tut: Ruhezustand, Heizen, Kühlen              |
| Thermostat Fan Mode               | Lüfterstufe: Auto, niedrig, mittel, hoch, leise                  |
| Color Switch                      | RGB-Farbe einer Lampe oder eines LED-Streifens                   |
| Door Lock                         | Schloss: verriegelt / entriegelt                                 |
| Sound Switch                      | Sirene Ein/Aus (spielt den Standardton), eine pro Endpoint       |
| Barrier Operator                  | Garagentor oder Einfahrtstor: öffnen/schließen + Öffnungssensor  |

### Thermostate

Ein Z-Wave-Thermostat stellt bis zu drei getrennte Sollwerte bereit — Heizen,
Kühlen und Energiesparen — und jeder wird in Gladys zu einer eigenen
Temperaturfunktion. Der **Modus** gibt an, was das Gerät tun soll; der
**Betriebszustand** gibt an, was es tatsächlich tut: Ein Thermostat im Modus
Heizen geht in den Ruhezustand, sobald der Raum warm genug ist.

Eine Einschränkung sollten Sie kennen: Der Z-Wave-Modus „Energy Save Heat“ hat
in Gladys keine Entsprechung. Er wird daher **als Heizen gemeldet** — was das
Gerät auch tut —, doch wenn Sie in Gladys Heizen auswählen, wechselt der
Thermostat vom Energiesparmodus ins normale Heizen. Die Energiespartemperatur
selbst bleibt über ihren eigenen Sollwert einstellbar.

In der Oberfläche werden die Modi Aus, Heizen, Kühlen und Automatisch
angeboten. Z-Wave gibt nicht zuverlässig an, welche Modi ein Gerät unterstützt;
ein Thermostat, der nur heizen kann, zeigt daher trotzdem Kühlen und
Automatisch an und ignoriert sie.

### Steuerleitungsmodule

Der **Qubino Flush Pilot** (ZMNHJA, ZMNHJD und seine Hutschienenversion ZMNHUD)
steuert einen Elektroheizkörper über dessen Steuerleitung (Fil Pilote). Auf
der Z-Wave-Seite gibt er sich als Dimmer aus, wobei jeder Bereich seines Pegels
für einen Befehl steht; in Gladys ist er eine einzige Funktion
**Steuerleitungsmodus**: Aus, Frostschutz, Öko, Komfort -2 °C, Komfort -1 °C,
Komfort. Wird ein Modul anderweitig eingestellt — über seine eigenen Tasten
oder Z-Wave JS UI —, zeigt es den entsprechenden Modus an.

Falls Sie es bereits als Dimmer hinzugefügt hatten, nehmen Sie die in Entdecken
angebotene Aktualisierung an: Die Funktionen Helligkeit, Ein/Aus und
„vorherigen Zustand wiederherstellen“ weichen dem Modus, und ihr Verlauf
verschwindet mit ihnen. Die Temperaturfunktion erhält erst Werte, wenn ein
Fühler an das Modul angeschlossen ist. Der verdrahtete Eingang des Moduls
erscheint als Ein/Aus-**Eingang**: Seine Bedeutung hängt davon ab, was Sie dort
angeschlossen haben.

### Farblampen, Schlösser, Sirenen, Garagentore

- **Farbe**: Nur die RGB-Farbe wird bereitgestellt; die Helligkeit bleibt beim
  Dimmer der Lampe. Die Kanäle Warmweiß / Kaltweiß werden nicht abgebildet.
- **Schloss**: Nur der Modus „secured“ gilt als verriegelt. Die Modi, in denen
  sich die Tür noch mit einer Klinke öffnen lässt (innen oder außen
  ungesichert, mit oder ohne Zeitlimit), werden als **entriegelt** angezeigt.
- **Sirene**: „Ein“ spielt den Standardton des Endpoints, der in der
  Gerätekonfiguration festgelegt ist (Parameter `defaultToneId` in
  Z-Wave JS UI).
- **Garagentor / Einfahrtstor**: Öffnen und Schließen funktionieren, **Stoppen
  wird abgelehnt** (die Command Class Barrier Operator kennt keinen
  Stoppbefehl). Der Öffnungssensor meldet „offen“, sobald das Tor nicht
  vollständig geschlossen ist, auch wenn es auf halbem Weg angehalten hat.
- **Thermostat-Lüfter**: Die drei „auto“-Modi von Z-Wave werden als Auto
  angezeigt; Auto wird als „auto low“ zurückgeschrieben, den einzigen Modus,
  den jeder Lüfterthermostat unterstützt. Modi ohne Entsprechung (Umwälzung…)
  zeigen nichts an.

Ein Knoten, der etwas anderes bereitstellt, erscheint trotzdem in Entdecken —
es werden nur die oben genannten Funktionen erstellt.

## Z-Wave-Netz: Widget und Szenen

Erfordert Gladys 5.3 oder neuer.

### Widget „Z-Wave-Netz“

Fügen Sie es über das Dashboard hinzu. Es zeigt die Anzahl der Knoten, die
Knoten, die **nicht antworten**, die **schwachen Batterien** und die schlafenden
Knoten, darunter die Liste dessen, was Aufmerksamkeit braucht (wie lange ein
Knoten schon stumm ist, Batteriestand, unvollständiges Interview). Zwei
Schaltflächen:

- **Aktualisieren** fragt die Knotenliste erneut bei Z-Wave JS UI ab;
- **Routen neu aufbauen** startet (nach einer Bestätigung) den Neuaufbau der
  Routen des gesamten Netzes. Das kann in einem großen Netz lange dauern und
  belastet die Funkverbindung währenddessen stark.

### Szenen-Auslöser

| Auslöser                               | Wann                                        |
| -------------------------------------- | ------------------------------------------- |
| Ein Z-Wave-Knoten antwortet nicht mehr | Z-Wave JS UI markiert den Knoten als tot    |
| Ein Z-Wave-Knoten antwortet wieder     | ein toter Knoten ist wieder erreichbar      |
| Ein Z-Wave-Knoten wird hinzugefügt     | ein Gerät wurde gerade ins Netz aufgenommen |

Die ersten beiden lassen sich auf ein Gerät beschränken; alle liefern die
Variablen „Knoten-ID“ und „Knotenname“, etwa zur Verwendung in einer
Benachrichtigung.

### Szenen-Aktionen

| Aktion                            | Wirkung                                                            |
| --------------------------------- | ------------------------------------------------------------------ |
| Z-Wave-Knoten anpingen            | prüft, ob der Knoten antwortet (Ausgabe: „Knoten hat geantwortet“) |
| Werte eines Knotens neu lesen     | fragt alle Werte des Knotens erneut ab                             |
| Routen eines Knotens neu aufbauen | repariert den Weg eines Knotens zum Controller                     |
| Routen des Netzes neu aufbauen    | startet eine Reparatur des gesamten Netzes                         |
| Konfigurationsparameter setzen    | schreibt einen Parameter aus dem Gerätehandbuch (Nummer + Wert)    |
| Z-Wave-Inklusion starten          | versetzt den Controller in den Inklusionsmodus                     |
| Z-Wave-Exklusion starten          | versetzt den Controller in den Exklusionsmodus                     |
| Inklusion oder Exklusion beenden  | beendet beide Modi                                                 |

Ein **batteriebetriebener** Knoten erhält eine Anfrage erst beim nächsten
Aufwachen, manchmal Stunden später. Die Aktion schlägt dann nicht fehl: Ihre
Ausgabe „Abgeschlossen“ ist falsch, und die Anfrage bleibt in Z-Wave JS UI in
der Warteschlange, bis der Knoten aufwacht.

Eine **sichere S2**-Inklusion verlangt die PIN des Geräts: Lassen Sie die Seite
von Z-Wave JS UI geöffnet, um sie einzugeben, oder wählen Sie „Unsicher“.

## Fehlerbehebung

**In Entdecken erscheint nichts.** Prüfen Sie den Status im Tab Konfiguration.
Meldet er, dass der Broker nicht erreichbar ist, sind die URL oder die
Zugangsdaten falsch. Ist er verbunden, aber kein Knoten erscheint, gehen Sie
„Z-Wave JS UI einrichten“ noch einmal durch: **Name** muss `zwave-js-ui` lauten
und **Prefix** `zwave`, sonst lauscht die Integration auf Topics, auf denen
niemand veröffentlicht.

**Ein Gerät aktualisiert sich nicht mehr.** Sehen Sie sich zuerst das Abzeichen
auf seiner Karte an. **Nicht erreichbar** bedeutet, dass Z-Wave JS UI den
Knoten für tot erklärt oder aus dem Netz entfernt hat; ein **orangefarbener
Punkt** bedeutet, dass sein Interview noch nicht abgeschlossen ist, sodass
einige Funktionen fehlen können, bis es fertig ist. Ein schlafendes
batteriebetriebenes Gerät ist normal und wird als lokal angezeigt. Für die
Details bleibt Z-Wave JS UI die maßgebliche Quelle.

**„State budget exhausted“ in den Protokollen.** Gladys akzeptiert 300 Zustände
pro Minute und Integration. Ein sehr gesprächiges Netz (Energiezähler, die alle
paar Sekunden melden) kann diese Grenze überschreiten: Die Integration behält
dann den ersten und den letzten Wert jeder Funktion und verwirft die
dazwischenliegenden. Die eigentliche Lösung besteht darin, in Z-Wave JS UI die
Meldefrequenz der gesprächigsten Geräte zu verringern.

Setzen Sie `LOG_LEVEL=debug` für ausführliche Protokolle, die Sie im Tab
**Protokolle** der Integration lesen können.

## Von der eingebauten Z-Wave-JS-UI-Integration migrieren

Gladys enthält einen eingebauten Dienst `zwavejs-ui`. Diese externe Integration
ersetzt ihn und erzeugt **dieselben Geräte, Funktionen, Kategorien, Einheiten
und Namen**, sodass Ihr Verlauf, Ihre Szenen und Ihre Dashboards übernommen
werden können.

1. Installieren und konfigurieren Sie diese Integration.
2. Erstellen Sie im Tab **Entdecken** die Geräte, die Ihren vorhandenen
   entsprechen.
3. Migrieren Sie jedes Gerät: Dabei wird sein Verlauf verschoben und die
   Verweise in Ihren Szenen und Dashboards werden umgeschrieben. Solange die
   eingebaute Integration in Gladys nicht als veraltet markiert ist, gibt es
   für die Migration noch keine Schaltfläche — rufen Sie die API direkt auf,
   einmal pro Gerät:

   ```
   POST /api/v1/device/<internal-device-selector>/migrate
   {
     "destination_device_selector": "<new-device-selector>",
     "features_mapping": {
       "<source-feature-selector>": "<destination-feature-selector>"
     }
   }
   ```

   Beide Geräte stellen dieselbe Funktionsliste in derselben Reihenfolge
   bereit, die Zuordnung ist also eins zu eins.

4. Sobald alle Geräte migriert sind, deaktivieren Sie die eingebaute
   Integration.

Die Migration löscht das Quellgerät: Führen Sie sie erst durch, wenn Sie mit
dem neuen Gerät zufrieden sind.
