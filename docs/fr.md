# Z-Wave JS UI

Pilotez votre réseau Z-Wave depuis Gladys, via
[Z-Wave JS UI](https://zwave-js.github.io/zwave-js-ui/) et un broker MQTT.

Cette intégration ne parle **pas** directement à votre clé Z-Wave. C'est
Z-Wave JS UI qui possède la radio et la gestion du réseau ; cette intégration
transforme les nœuds qu'il publie en appareils Gladys, et les commandes Gladys
en commandes Z-Wave. Elle lui relaie aussi quelques opérations de réseau
(inclusion, exclusion, réparation des routes) depuis les scènes et le widget
« Réseau Z-Wave ».

## Prérequis

1. **Z-Wave JS UI**, démarré et déjà appairé avec votre contrôleur Z-Wave.
2. **Un broker MQTT** (Mosquitto, EMQX…) joignable à la fois par Z-Wave JS UI
   et par Gladys.

## Configurer Z-Wave JS UI

L'intégration attend des topics MQTT nommés d'une façon précise. Ces réglages
ne sont pas configurables côté Gladys : c'est Z-Wave JS UI qui doit s'aligner.

Dans **Settings**, section **MQTT** :

- **Name** : `zwave-js-ui` — sinon le préfixe de certains topics sera erroné ;
- **Prefix** : `zwave` ;
- **Host url** / **Port** : votre broker, ainsi que l'utilisateur et le mot de
  passe s'il les exige.

![Section MQTT](./images/zwavejs-ui-mqtt-configuration.jpg)

Puis, section **Gateway**, exactement ces paramètres :

- **Topic type** : `Named topics` ;
- **Payload type** : `Entire Z-Wave value Object` ;
- **Send Z-Wave events** : activé ;
- **Include Node info** : activé ;
- **Publish node details** : activé ;
- **Ignore location** et **Ignore status updates** : désactivés.

![Section Gateway](./images/zwavejs-ui-gateway-configuration.jpg)

Sans le type de payload et les événements Z-Wave, aucun état d'appareil
n'arrivera jusqu'à Gladys.

## Configurer l'intégration

Dans Gladys, ouvrez l'onglet **Configuration** de l'intégration :

1. **URL du broker MQTT** — par exemple `mqtt://192.168.1.10:1883`.
2. **Utilisateur / mot de passe MQTT** — à laisser vides pour un broker
   anonyme.
3. Enregistrez.

Le bouton **Tester la connexion** vérifie le lien : il indique le broker
atteint et le nombre de nœuds Z-Wave visibles.

## Ajouter vos appareils

Ouvrez l'onglet **Découverte** : chaque nœud Z-Wave non virtuel y apparaît,
avec les fonctionnalités que cette intégration sait interpréter. Choisissez une
pièce, ajustez le nom, et créez les appareils souhaités. **Scanner** demande à
Z-Wave JS UI une liste de nœuds fraîche — utile juste après avoir inclus un
nouvel appareil.

Un appareil que vous créez est renseigné immédiatement à partir des dernières
valeurs connues : il n'attend pas le réveil d'un capteur sur pile pour afficher
quelque chose.

## Appareils supportés

Les fonctionnalités sont déduites des command classes Z-Wave exposées par le
nœud :

| Command class                  | Ce que vous obtenez dans Gladys                                  |
| ------------------------------ | ---------------------------------------------------------------- |
| Binary Switch                  | interrupteur on/off                                              |
| Multilevel Switch (variateur)  | luminosité, on/off, « restaurer l'état précédent »               |
| Multilevel Switch (volet)      | position du volet, ouvrir/fermer/stop                            |
| Multilevel Switch (fil pilote) | mode de chauffage : arrêt, hors-gel, éco, confort…               |
| Binary Sensor / Alarm Sensor   | mouvement, fumée, CO, CO₂, fuite, ouverture, température         |
| Notification                   | ouverture de porte/fenêtre, alarme fumée, alarme CO              |
| Multilevel Sensor              | température, luminosité, puissance                               |
| Meter                          | énergie, puissance, tension, courant                             |
| Central Scene                  | appuis de bouton (simple, double, triple, maintenu, relâché)     |
| Battery                        | niveau et indicateur de batterie faible                          |
| Thermostat Mode                | mode : arrêt, chauffage, climatisation, automatique              |
| Thermostat Setpoint            | consignes de chauffage, de climatisation et d'économie           |
| Thermostat Operating State     | état réel : au repos, en chauffe, en refroidissement             |
| Thermostat Fan Mode            | vitesse de ventilation : auto, basse, moyenne, haute, silence    |
| Color Switch                   | couleur RGB d'une ampoule ou d'un ruban LED                      |
| Door Lock                      | serrure : verrouillée / déverrouillée                            |
| Sound Switch                   | sirène on/off (joue la mélodie par défaut), une par endpoint     |
| Barrier Operator               | porte de garage ou portail : ouvrir/fermer + capteur d'ouverture |

### Thermostats

Un thermostat Z-Wave expose jusqu'à trois consignes distinctes — chauffage,
climatisation et économie d'énergie — et chacune devient une fonctionnalité de
température indépendante dans Gladys. Le **mode** dit ce que l'appareil doit
faire, l'**état de fonctionnement** dit ce qu'il fait réellement : un
thermostat en mode Chauffage passe au repos une fois la pièce à température.

Une limite à connaître : le mode Z-Wave « Energy Save Heat » n'a pas
d'équivalent dans Gladys. Il est donc **remonté comme Chauffage** — ce que fait
l'appareil est exact — mais si vous sélectionnez Chauffage depuis Gladys, le
thermostat quitte le mode économie pour le chauffage normal. La température
d'économie, elle, reste réglable via sa propre consigne.

Les modes proposés dans l'interface sont Arrêt, Chauffage, Climatisation et
Automatique. Z-Wave n'indiquant pas de façon fiable les modes réellement
supportés par un appareil, un thermostat qui ne sait que chauffer affichera
quand même Climatisation et Automatique, et les ignorera.

### Modules fil pilote

Le **Qubino Flush Pilot** (ZMNHJA, ZMNHJD et sa version rail DIN ZMNHUD)
pilote un radiateur électrique par son fil pilote. Côté Z-Wave, il se fait
passer pour un variateur dont chaque plage de niveau correspond à un ordre ;
dans Gladys, c'est une seule fonctionnalité **mode fil pilote** : arrêt,
hors-gel, éco, confort -2 °C, confort -1 °C, confort. Un module réglé
d'ailleurs — ses propres boutons, Z-Wave JS UI — affiche le mode correspondant.

Si vous l'aviez déjà ajouté comme variateur, acceptez la mise à jour proposée
dans la Découverte : la luminosité, le on/off et « restaurer l'état précédent »
laissent place au mode, et leur historique avec eux. La fonctionnalité de
température ne reçoit de valeurs qu'une fois une sonde branchée sur le module.
L'entrée filaire du module apparaît comme une **entrée** on/off : sa
signification dépend de ce que vous y avez branché.

### Lumières couleur, serrures, sirènes, portes de garage

- **Couleur** : seule la couleur RGB est exposée ; la luminosité reste celle du
  variateur de l'ampoule. Les canaux blanc chaud / blanc froid ne sont pas
  repris.
- **Serrure** : seul le mode « sécurisé » compte comme verrouillé. Les modes
  où une poignée ouvre encore la porte (intérieur ou extérieur déverrouillé,
  avec ou sans minuterie) sont affichés **déverrouillés**.
- **Sirène** : « on » joue la mélodie par défaut de l'endpoint, réglée dans la
  configuration de l'appareil (paramètre `defaultToneId` dans Z-Wave JS UI).
- **Porte de garage / portail** : ouvrir et fermer fonctionnent, **stop est
  refusé** (la command class Barrier Operator n'a pas d'ordre d'arrêt). Le
  capteur d'ouverture indique « ouvert » dès que la porte n'est pas
  complètement fermée, même arrêtée à mi-course.
- **Ventilation d'un thermostat** : les trois modes « auto » de Z-Wave sont
  affichés Auto ; Auto est renvoyé comme « auto basse », le seul mode que tous
  les thermostats supportent. Les modes sans équivalent (circulation…)
  n'affichent rien.

Un nœud exposant autre chose apparaît quand même dans la Découverte — seules
les fonctionnalités ci-dessus sont créées.

## Réseau Z-Wave : widget et scènes

Nécessite Gladys 5.3 ou plus récent.

### Widget « Réseau Z-Wave »

À ajouter depuis le tableau de bord. Il affiche le nombre de nœuds, ceux qui
**ne répondent plus**, les **piles faibles** et les nœuds endormis, puis la
liste de ce qui demande votre attention (nœud muet depuis combien de temps,
niveau de pile, interview incomplète). Deux boutons :

- **Actualiser** redemande la liste des nœuds à Z-Wave JS UI ;
- **Réparer les routes** lance la reconstruction des routes de tout le réseau
  (après confirmation). Elle peut durer longtemps sur un grand réseau, et
  sollicite fortement la radio pendant ce temps.

### Déclencheurs de scène

| Déclencheur                      | Quand                                          |
| -------------------------------- | ---------------------------------------------- |
| Un nœud Z-Wave ne répond plus    | Z-Wave JS UI déclare le nœud mort              |
| Un nœud Z-Wave répond de nouveau | un nœud déclaré mort redevient joignable       |
| Un nœud Z-Wave est ajouté        | un appareil vient d'être inclus dans le réseau |

Les deux premiers peuvent être limités à un appareil ; tous fournissent les
variables « Numéro du nœud » et « Nom du nœud », à utiliser par exemple dans
une notification.

### Actions de scène

| Action                               | Effet                                                        |
| ------------------------------------ | ------------------------------------------------------------ |
| Interroger un nœud Z-Wave            | vérifie que le nœud répond (sortie : « Le nœud a répondu »)  |
| Relire les valeurs d'un nœud         | redemande toutes ses valeurs au nœud                         |
| Reconstruire les routes d'un nœud    | répare le chemin d'un nœud vers le contrôleur                |
| Reconstruire les routes du réseau    | lance la réparation de tout le réseau                        |
| Régler un paramètre de configuration | écrit un paramètre du manuel de l'appareil (numéro + valeur) |
| Lancer une inclusion Z-Wave          | met le contrôleur en mode inclusion                          |
| Lancer une exclusion Z-Wave          | met le contrôleur en mode exclusion                          |
| Arrêter l'inclusion ou l'exclusion   | quitte les deux modes                                        |

Un nœud **sur pile** ne reçoit une demande qu'à son prochain réveil, parfois
des heures plus tard. Dans ce cas l'action ne tombe pas en erreur : sa sortie
« Terminé » vaut faux, et la demande reste en attente dans Z-Wave JS UI
jusqu'au réveil.

Une inclusion **sécurisée S2** demande de saisir le code PIN de l'appareil :
gardez la page de Z-Wave JS UI ouverte pour le faire, ou choisissez
« Non sécurisée ».

## En cas de problème

**Rien n'apparaît dans la Découverte.** Regardez le statut dans l'onglet
Configuration. S'il indique que le broker est injoignable, l'URL ou les
identifiants sont erronés. S'il est connecté mais qu'aucun nœud n'apparaît,
reprenez la section « Configurer Z-Wave JS UI » : le champ **Name** doit valoir
`zwave-js-ui` et **Prefix** `zwave`, faute de quoi l'intégration écoute des
topics que personne n'alimente.

**Un appareil ne se met plus à jour.** Regardez d'abord le badge sur sa carte.
**Injoignable** signifie que Z-Wave JS UI a déclaré le nœud mort, ou l'a
retiré du réseau ; un **point orange** signale une interview inachevée :
des fonctionnalités peuvent manquer jusqu'à ce qu'elle se termine. Un appareil
sur pile endormi est normal et apparaît comme local. Z-Wave JS UI reste la
référence pour le détail.

**« State budget exhausted » dans les logs.** Gladys accepte 300 états par
minute et par intégration. Un réseau très bavard (compteurs d'énergie
rapportant toutes les quelques secondes) peut dépasser cette limite :
l'intégration conserve alors la première et la dernière valeur de chaque
fonctionnalité et abandonne les intermédiaires. La vraie correction consiste à
réduire la fréquence de report des appareils les plus bavards dans
Z-Wave JS UI.

Passez `LOG_LEVEL=debug` pour des logs détaillés, consultables dans l'onglet
**Logs** de l'intégration.

## Migrer depuis l'intégration Z-Wave JS UI intégrée

Gladys embarque un service `zwavejs-ui` natif. Cette intégration externe le
remplace et produit **les mêmes appareils, fonctionnalités, catégories, unités
et noms** : votre historique, vos scènes et vos dashboards peuvent donc suivre.

1. Installez et configurez cette intégration.
2. Dans l'onglet **Découverte**, créez les appareils correspondant à ceux que
   vous possédez déjà.
3. Migrez chaque appareil : l'opération déplace son historique et réécrit les
   références dans vos scènes et vos dashboards. Tant que l'intégration native
   n'est pas marquée comme dépréciée dans Gladys, la migration n'a pas encore
   de bouton — appelez l'API directement, une fois par appareil :

   ```
   POST /api/v1/device/<selector-appareil-interne>/migrate
   {
     "destination_device_selector": "<selector-nouvel-appareil>",
     "features_mapping": {
       "<selector-feature-source>": "<selector-feature-destination>"
     }
   }
   ```

   Les deux appareils exposent la même liste de fonctionnalités dans le même
   ordre : la correspondance est donc du un pour un.

4. Une fois tous les appareils migrés, désactivez l'intégration native.

La migration supprime l'appareil source : faites-la une fois satisfait du
nouveau.
