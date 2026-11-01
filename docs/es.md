# Z-Wave JS UI

Controle su red Z-Wave desde Gladys, mediante
[Z-Wave JS UI](https://zwave-js.github.io/zwave-js-ui/) y un broker MQTT.

Esta integración **no** habla directamente con su stick Z-Wave. Es Z-Wave JS UI
quien gestiona la radio y la red; esta integración convierte los nodos que
publica en dispositivos de Gladys, y las órdenes de Gladys en órdenes Z-Wave.
También le transmite algunas operaciones de red (inclusión, exclusión,
reconstrucción de rutas) desde las escenas y el widget «Red Z-Wave».

## Requisitos

1. **Z-Wave JS UI**, en marcha y ya emparejado con su controlador Z-Wave.
2. **Un broker MQTT** (Mosquitto, EMQX…) accesible tanto desde Z-Wave JS UI
   como desde Gladys.

## Configurar Z-Wave JS UI

La integración espera topics MQTT con un nombre concreto. No se pueden
configurar desde Gladys: es Z-Wave JS UI quien debe ajustarse.

En **Settings**, sección **MQTT**:

- **Name**: `zwave-js-ui` — si no, el prefijo de algunos topics será erróneo;
- **Prefix**: `zwave`;
- **Host url** / **Port**: su broker, además del usuario y la contraseña si los
  exige.

![Sección MQTT](./images/zwavejs-ui-mqtt-configuration.jpg)

Después, en la sección **Gateway**, exactamente estos ajustes:

- **Topic type**: `Named topics`;
- **Payload type**: `Entire Z-Wave value Object`;
- **Send Z-Wave events**: activado;
- **Include Node info**: activado;
- **Publish node details**: activado;
- **Ignore location** e **Ignore status updates**: desactivados.

![Sección Gateway](./images/zwavejs-ui-gateway-configuration.jpg)

Sin el tipo de payload y los eventos Z-Wave, ningún estado de dispositivo llega
a Gladys.

## Configurar la integración

En Gladys, abra la pestaña **Configuración** de la integración:

1. **URL del broker MQTT** — por ejemplo `mqtt://192.168.1.10:1883`.
2. **Usuario / Contraseña MQTT** — déjelos vacíos para un broker anónimo.
3. Guarde.

Use **Probar la conexión** para comprobar el enlace: indica el broker al que
ha llegado y cuántos nodos Z-Wave ve.

## Añadir sus dispositivos

Abra la pestaña **Descubrir**: cada nodo Z-Wave no virtual aparece allí, con
las funciones que esta integración sabe interpretar. Elija una habitación,
ajuste el nombre y cree los dispositivos que desee. **Buscar** pide a
Z-Wave JS UI una lista de nodos actualizada — útil justo después de incluir un
dispositivo nuevo.

Un dispositivo que crea se rellena de inmediato con los últimos valores
conocidos, así que no queda en blanco mientras espera a que despierte un sensor
a pilas.

## Dispositivos compatibles

Las funciones se deducen de las command classes Z-Wave que expone el nodo:

| Command class                   | Lo que obtiene en Gladys                                          |
| ------------------------------- | ----------------------------------------------------------------- |
| Binary Switch                   | interruptor encendido/apagado                                     |
| Multilevel Switch (regulador)   | brillo, encendido/apagado, «restaurar el estado anterior»         |
| Multilevel Switch (persiana)    | posición de la persiana, abrir/cerrar/detener                     |
| Multilevel Switch (hilo piloto) | modo de calefacción: apagado, protección antihielo, eco, confort… |
| Binary Sensor / Alarm Sensor    | movimiento, humo, CO, CO₂, fuga, apertura, temperatura            |
| Notification                    | apertura de puerta/ventana, alarma de humo, alarma de CO          |
| Multilevel Sensor               | temperatura, iluminancia, potencia                                |
| Meter                           | energía, potencia, tensión, corriente                             |
| Central Scene                   | pulsaciones de botón (simple, doble, triple, mantenida, soltada)  |
| Battery                         | nivel e indicador de batería baja                                 |
| Thermostat Mode                 | modo: apagado, calor, frío, auto                                  |
| Thermostat Setpoint             | consignas de calefacción, refrigeración y ahorro de energía       |
| Thermostat Operating State      | lo que hace realmente: en reposo, calentando, enfriando           |
| Thermostat Fan Mode             | velocidad del ventilador: auto, baja, media, alta, silencioso     |
| Color Switch                    | color RGB de una bombilla o de una tira LED                       |
| Door Lock                       | cerradura: bloqueada / desbloqueada                               |
| Sound Switch                    | sirena encendida/apagada (tono por defecto), una por endpoint     |
| Barrier Operator                | puerta de garaje o cancela: abrir/cerrar + sensor de apertura     |

### Termostatos

Un termostato Z-Wave expone hasta tres consignas distintas — calefacción,
refrigeración y ahorro de energía — y cada una se convierte en una función de
temperatura propia en Gladys. El **modo** es lo que se pide al dispositivo; el
**estado de funcionamiento** es lo que hace realmente: un termostato en modo
Calor pasa a reposo cuando la habitación está lo bastante caliente.

Una limitación que conviene conocer: el modo Z-Wave «Energy Save Heat» no tiene
equivalente en Gladys. Por eso se **notifica como Calor** — que es lo que hace
el dispositivo —, pero si selecciona Calor desde Gladys, el termostato pasa del
ahorro de energía a la calefacción normal. La temperatura de ahorro sigue
siendo ajustable mediante su propia consigna.

Los modos que ofrece la interfaz son Apagado, Calor, Frío y Auto. Z-Wave no
indica de forma fiable qué modos admite un dispositivo, así que un termostato
que solo calienta muestra igualmente Frío y Auto, y los ignora.

### Módulos de hilo piloto

El **Qubino Flush Pilot** (ZMNHJA, ZMNHJD y su versión para carril DIN ZMNHUD)
controla un radiador eléctrico a través de su hilo piloto. En el lado Z-Wave se
hace pasar por un regulador, en el que cada tramo de su nivel corresponde a una
orden; en Gladys es una única función **modo hilo piloto**: apagado,
protección antihielo, eco, confort -2 °C, confort -1 °C, confort. Un módulo
ajustado desde otro sitio — sus propios botones, Z-Wave JS UI — muestra el modo
correspondiente.

Si ya lo había añadido como regulador, acepte la actualización que se ofrece en
Descubrir: las funciones de brillo, encendido/apagado y «restaurar el estado
anterior» dejan paso al modo, y su historial se va con ellas. La función de
temperatura solo recibe valores cuando hay una sonda conectada al módulo. La
entrada cableada del módulo aparece como una **entrada** encendido/apagado: su
significado depende de lo que haya conectado a ella.

### Luces de color, cerraduras, sirenas, puertas de garaje

- **Color**: solo se expone el color RGB; el brillo sigue en el regulador de la
  bombilla. Los canales de blanco cálido / blanco frío no se asignan.
- **Cerradura**: solo el modo «secured» cuenta como bloqueada. Los modos en los
  que una manilla todavía abre la puerta (interior o exterior sin asegurar, con
  o sin temporizador) se muestran como **desbloqueada**.
- **Sirena**: «encendido» reproduce el tono por defecto del endpoint, definido
  en la configuración del dispositivo (el parámetro `defaultToneId` en
  Z-Wave JS UI).
- **Puerta de garaje / cancela**: abrir y cerrar funcionan, **detener se
  rechaza** (la command class Barrier Operator no tiene orden de parada). El
  sensor de apertura indica «abierta» en cuanto la puerta no está
  completamente cerrada, aunque esté detenida a medio camino.
- **Ventilador del termostato**: los tres modos «auto» de Z-Wave se muestran
  como Auto; Auto se escribe como «auto low», el único modo que admiten todos
  los termostatos con ventilador. Los modos sin equivalente (circulación…) no
  muestran nada.

Un nodo que expone otra cosa aparece igualmente en Descubrir — solo se crean
las funciones anteriores.

## Red Z-Wave: widget y escenas

Requiere Gladys 5.3 o posterior.

### Widget «Red Z-Wave»

Añádalo desde el panel. Muestra cuántos nodos hay, los que **no responden**,
las **pilas bajas** y los nodos dormidos, y después la lista de lo que requiere
atención (cuánto tiempo lleva un nodo sin dar señales, nivel de pila,
entrevista incompleta). Dos botones:

- **Actualizar** vuelve a pedir la lista de nodos a Z-Wave JS UI;
- **Reparar rutas** inicia la reconstrucción de las rutas de toda la red (tras
  una confirmación). Puede tardar mucho en una red grande y mantiene la radio
  ocupada mientras tanto.

### Desencadenantes de escena

| Desencadenante                    | Cuándo                                      |
| --------------------------------- | ------------------------------------------- |
| Un nodo Z-Wave deja de responder  | Z-Wave JS UI marca el nodo como muerto      |
| Un nodo Z-Wave vuelve a responder | un nodo muerto vuelve a estar accesible     |
| Se añade un nodo Z-Wave           | un dispositivo acaba de incluirse en la red |

Los dos primeros pueden limitarse a un dispositivo; todos proporcionan las
variables «ID del nodo» y «Nombre del nodo», para usarlas por ejemplo en una
notificación.

### Acciones de escena

| Acción                                | Efecto                                                           |
| ------------------------------------- | ---------------------------------------------------------------- |
| Hacer ping a un nodo Z-Wave           | comprueba que el nodo responde (salida: «El nodo respondió»)     |
| Releer los valores de un nodo         | vuelve a pedir todos sus valores al nodo                         |
| Reconstruir las rutas de un nodo      | repara el camino de un nodo al controlador                       |
| Reconstruir las rutas de la red       | inicia la reparación de toda la red                              |
| Ajustar un parámetro de configuración | escribe un parámetro del manual del dispositivo (número + valor) |
| Iniciar una inclusión Z-Wave          | pone el controlador en modo inclusión                            |
| Iniciar una exclusión Z-Wave          | pone el controlador en modo exclusión                            |
| Detener la inclusión o exclusión      | sale de ambos modos                                              |

Un nodo **a pilas** solo recibe una petición en su próximo despertar, a veces
horas más tarde. La acción no falla en ese caso: su salida «Completado» vale
falso, y la petición queda en espera en Z-Wave JS UI hasta que el nodo
despierte.

Una inclusión **segura S2** pide el PIN del dispositivo: mantenga abierta la
página de Z-Wave JS UI para introducirlo, o elija «No segura».

## Solución de problemas

**No aparece nada en Descubrir.** Compruebe el estado en la pestaña
Configuración. Si indica que el broker es inaccesible, la URL o las
credenciales son incorrectas. Si está conectado pero no aparece ningún nodo,
repase «Configurar Z-Wave JS UI»: **Name** debe ser `zwave-js-ui` y **Prefix**
`zwave`, o la integración escucha en topics en los que nadie publica.

**Un dispositivo ya no se actualiza.** Mire primero la insignia de su tarjeta.
**Inaccesible** significa que Z-Wave JS UI ha declarado el nodo muerto, o lo ha
retirado de la red; un **punto naranja** significa que su entrevista no ha
terminado, así que pueden faltar algunas funciones hasta que se complete. Un
dispositivo a pilas dormido es normal y se muestra como local. Z-Wave JS UI
sigue siendo la referencia para los detalles.

**«State budget exhausted» en los registros.** Gladys acepta 300 estados por
minuto y por integración. Una red muy habladora (contadores de energía que
informan cada pocos segundos) puede superarlo: la integración conserva
entonces el primer y el último valor de cada función y descarta los
intermedios. La solución de fondo es reducir en Z-Wave JS UI la frecuencia de
informe de los dispositivos más habladores.

Defina `LOG_LEVEL=debug` para obtener registros detallados, que puede leer en
la pestaña **Registros** de la integración.

## Migrar desde la integración Z-Wave JS UI incorporada

Gladys incluye un servicio `zwavejs-ui` incorporado. Esta integración externa
lo sustituye y produce **los mismos dispositivos, funciones, categorías,
unidades y nombres**, de modo que su historial, sus escenas y sus paneles
pueden conservarse.

1. Instale y configure esta integración.
2. En la pestaña **Descubrir**, cree los dispositivos que correspondan a los
   que ya tiene.
3. Migre cada dispositivo: la operación traslada su historial y reescribe las
   referencias en sus escenas y paneles. Mientras la integración incorporada no
   esté marcada como obsoleta en Gladys, la migración aún no tiene botón —
   llame directamente a la API, una vez por dispositivo:

   ```
   POST /api/v1/device/<internal-device-selector>/migrate
   {
     "destination_device_selector": "<new-device-selector>",
     "features_mapping": {
       "<source-feature-selector>": "<destination-feature-selector>"
     }
   }
   ```

   Ambos dispositivos exponen la misma lista de funciones en el mismo orden,
   así que la correspondencia es uno a uno.

4. Cuando todos los dispositivos estén migrados, desactive la integración
   incorporada.

La migración elimina el dispositivo de origen: hágala cuando esté satisfecho
con el nuevo.
