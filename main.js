// main.js

let produits = [];    // Array d'objets produits (Référence, Nom, Poids_unité, Volume_unité, Refrigerer, …)
let conteneurs = [];  // Array d'objets conteneurs ("NAME ", "ID ", Poids_max, Capacite_plus_de_quatre, Capacite_quatre_ou_moins, …)

/**
 * Au chargement de la page :
 *   1. Charger produits.json et conteneurs.json
 *   2. Générer le tableau des produits
 *   3. Brancher le bouton “Calculer” sur traiterCalcul()
 */
window.addEventListener("DOMContentLoaded", async () => {
  try {
    const [respP, respC] = await Promise.all([
      fetch("produits.json"),
      fetch("conteneurs.json")
    ]);
    if (!respP.ok || !respC.ok) {
      throw new Error("Impossible de charger les fichiers JSON.");
    }
    produits = await respP.json();
    conteneurs = await respC.json();

    genererTableProduits();
    document.getElementById("btn-calculer")
            .addEventListener("click", traiterCalcul);
  } catch (err) {
    alert("Erreur au chargement des données : " + err.message);
    console.error(err);
  }
});

/**
 * Remplit dynamiquement le <tbody> du tableau produits avec :
 *   – Référence, Nom, Poids_unité, Volume_unité, Refrigerer, Quantité
 */
function genererTableProduits() {
  const tbody = document.querySelector("#table-produits tbody");
  tbody.innerHTML = "";

  produits.forEach((prod, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${prod["Référence"]}</td>
      <td>${prod["Nom"] || ""}</td>
      <td>${parseFloat(prod["Poids_unité"]).toLocaleString("fr-FR", { minimumFractionDigits: 3 })}</td>
      <td>${parseFloat(prod["Volume_unité"]).toLocaleString("fr-FR", { minimumFractionDigits: 6 })}</td>
      <td style="text-align: center;">${prod["Refrigerer"] == 1 ? "✅" : "—"}</td>
      <td>
        <input
          type="number"
          id="quantite-${i}"
          min="0"
          step="1"
          value="0"
          style="width: 60px;"
        />
      </td>
    `;
    tbody.appendChild(tr);
  });
}

/**
 * Lors du clic sur “Calculer le(s) conteneur(s) optimal(aux)” :
 * 1) Calcule totaux séparés pour réfrigérés et non réfrigérés.
 * 2) Si aucun produit total (Réfrig + Sec) → “Aucune quantité saisie.”
 * 3) Pour la partie réfrigérée (si présente) :
 *    • Trouver le(s) conteneur(s) réfrigéré(s) optimaux pour totalRefVol/totalRefPds.
 *    • Calculer leur capacité cumulée (volRefCapSum, pdsRefCapSum).
 *    • Déterminer l’espace restant dans ces conteneurs réfrigérés (resteVolRef, restePdsRef).
 * 4) Remplir autant que possible les récipients réfrigérés avec des produits non réfrigérés :
 *    • Si remainDryVol ≤ resteVolRef et remainDryPds ≤ restePdsRef, alors tous les non réfrigérés
 *      tiennent dans les conteneurs réfrigérés restants → on n’a besoin d’aucun conteneur sec.
 *    • Sinon, calculer remainDryVol’ = remainDryVol − resteVolRef, remainDryPds’ = remainDryPds − restePdsRef,
 *      et passer à l’étape 5 avec ces restes.
 * 5) Si reste de non réfrigérés > 0 :
 *    • Trouver le(s) conteneur(s) sec(s) optimaux pour remainDryVol’, remainDryPds’.
 * 6) Générer un seul affichage final : un bloc “Réfrigéré” (si applicable) et, au besoin, un bloc “Sec”.
 */
function traiterCalcul() {
  // 1) Totaux séparés
  let totalRefPds = 0, totalRefVol = 0;
  let totalDryPds = 0, totalDryVol = 0;

  produits.forEach((prod, i) => {
    const qt = parseInt(document.getElementById(`quantite-${i}`).value, 10) || 0;
    if (qt <= 0) return;
    const poidsUn = parseFloat(prod["Poids_unité"]);
    const volUn   = parseFloat(prod["Volume_unité"]);
    if (prod["Refrigerer"] == 1) {
      totalRefPds += qt * poidsUn;
      totalRefVol += qt * volUn;
    } else {
      totalDryPds += qt * poidsUn;
      totalDryVol += qt * volUn;
    }
  });

  const totalVolAll = totalRefVol + totalDryVol;
  const totalPdsAll = totalRefPds + totalDryPds;

  // 2) Si aucune quantité saisie
  if (totalVolAll === 0 && totalPdsAll === 0) {
    afficherMessage({
      html: `<div class="message"><em>Aucune quantité saisie.</em></div>`
    });
    return;
  }

  // 3) Gestion de la partie RÉFRIGÉRÉE (si totalRef > 0)
  let htmlResultat = "";
  let resteVolRef = 0, restePdsRef = 0;
  if (totalRefVol > 0 || totalRefPds > 0) {
    // 3a) Filtrer pour TC20R, TC40R, TC40CHR (*** ici on corrige la faute : c'était "TC40HCR" ***)
    const contRef = conteneurs.filter(c => {
      const code = (c["NAME "] || "").trim();
      return code === "TC20R" || code === "TC40R" || code === "TC40CHR";
    });
    const resRef = findOptimalContainers(totalRefVol, totalRefPds, contRef);
    // Conserver l’espace restant dans ces conteneurs R
    resteVolRef = resRef.resteVolume;
    restePdsRef = resRef.restePoids;

    // Générer bloc HTML pour la partie réfrigérée
    htmlResultat += formatResultMessage(
      "Conteneur(s) réfrigéré(s) pour produits réfrigérés",
      totalRefVol,
      totalRefPds,
      resRef
    );
  }

  // 4) Essayer de mettre des produits non réfrigérés DANS l’espace restant des conteneurs R
  let remainDryVol = totalDryVol;
  let remainDryPds = totalDryPds;
  if ((totalRefVol > 0 || totalRefPds > 0) && (totalDryVol > 0 || totalDryPds > 0)) {
    // On a à la fois du réfrigéré et du sec
    // 4a) Si tout le Sec tient dans l’espace restant R → plus besoin de container sec
    if (remainDryVol <= resteVolRef && remainDryPds <= restePdsRef) {
      // On affiche un petit message complémentaire
      htmlResultat += `
        <div class="message categorie">
          <div class="message-item titre">Remarque :</div>
          <div class="message-item">Tous les produits non réfrigérés tiennent dans l’espace restant des conteneurs réfrigérés.</div>
        </div>
      `;
      // Et on met remainDryVol/Pds à zéro pour ne pas calculer de conteneur sec
      remainDryVol = 0;
      remainDryPds = 0;
    } else {
      // 4b) Sinon, on réduit remainDry par l’espace restant R
      remainDryVol -= resteVolRef;
      remainDryPds -= restePdsRef;
      remainDryVol = Math.max(0, remainDryVol);
      remainDryPds = Math.max(0, remainDryPds);
    }
  }

  // 5) Si il reste du sec à embarquer (remainDry > 0) → chercher container(s) secs
  if (remainDryVol > 0 || remainDryPds > 0) {
    // Filtrer TOUS les conteneurs non-R (*** ici on exclut TC40CHR, pas TC40HCR ***)
    const contDry = conteneurs.filter(c => {
      const code = (c["NAME "] || "").trim();
      return code !== "TC20R" && code !== "TC40R" && code !== "TC40CHR";
    });
    const resDry = findOptimalContainers(remainDryVol, remainDryPds, contDry);
    htmlResultat += formatResultMessage(
      "Conteneur(s) sec(s) pour produits non réfrigérés restants",
      remainDryVol,
      remainDryPds,
      resDry
    );
  }

  // 6) Afficher le tout
  afficherMessage({ html: htmlResultat });
}

/**
 * findOptimalContainers(totalVol, totalPds, availableContainers):
 *   - totalVol, totalPds = besoins totaux à couvrir.
 *   - availableContainers = array d’objets conteneur
 *     (avec "NAME ", "Poids_max", "Capacite_plus_de_quatre", …).
 *
 * Algorithme :
 *   1. Créer list = [{ code, volCap, pdsCap }, …], trié par volCap asc, puis pdsCap asc.
 *   2. Chercher un unique conteneur qui couvre totalVol/totalPds,
 *      en minimisant d’abord (volCap - totalVol), puis (pdsCap - totalPds).
 *      Si on en trouve un, on renvoie { containers: [code], capVolume, capPoids, resteVolume, restePoids }.
 *   3. Sinon, tester toutes les paires (i ≤ j), calculer (volCap1+volCap2, pdsCap1+pdsCap2),
 *      ne garder que celles qui couvrent, et retenir la paire minimisant (volSum - totalVol),
 *      puis (pdsSum - totalPds). Si on en trouve, on renvoie { containers: [code1,code2], … }.
 *   4. Sinon, prendre N exemplaires du plus grand conteneur (dernier de list) pour couvrir à la fois,
 *      en calculant nbByVol = ceil(totalVol / largest.volCap), nbByPds = ceil(totalPds / largest.pdsCap),
 *      nbNeeded = max(nbByVol, nbByPds), puis { containers: Array(nbNeeded).fill(largest.code), … }.
 *   5. Si list.length === 0, on renvoie objet contenant { error: "Aucun conteneur dispo" }.
 */
function findOptimalContainers(totalVol, totalPds, availableContainers) {
  // 1. Construire et trier `list`
  const list = availableContainers
    .map(c => ({
      code:   (c["NAME "] || "").trim(),
      volCap: parseFloat(c["Capacite_plus_de_quatre"]),
      pdsCap: parseFloat(c["Poids_max"])
    }))
    .filter(c => c.code && !isNaN(c.volCap) && !isNaN(c.pdsCap))
    .sort((a, b) => {
      if (a.volCap !== b.volCap) return a.volCap - b.volCap;
      return a.pdsCap - b.pdsCap;
    });

  // 2. Conteneur UNIQUE
  let meilleurMono = null;
  for (let c of list) {
    if (c.volCap >= totalVol && c.pdsCap >= totalPds) {
      const wasteVol = c.volCap - totalVol;
      const wastePds = c.pdsCap - totalPds;
      if (
        !meilleurMono ||
        wasteVol < meilleurMono.wasteVol ||
        (wasteVol === meilleurMono.wasteVol && wastePds < meilleurMono.wastePds)
      ) {
        meilleurMono = { container: c, wasteVol, wastePds };
      }
    }
  }
  if (meilleurMono) {
    const c = meilleurMono.container;
    return {
      containers:   [c.code],
      capVolume:    c.volCap,
      capPoids:     c.pdsCap,
      resteVolume:  parseFloat((c.volCap - totalVol).toFixed(6)),
      restePoids:   parseFloat((c.pdsCap - totalPds).toFixed(3))
    };
  }

  // 3. Tester PAIRES
  let meilleurPair = null;
  for (let i = 0; i < list.length; i++) {
    for (let j = i; j < list.length; j++) {
      const c1 = list[i];
      const c2 = list[j];
      const volSum = c1.volCap + c2.volCap;
      const pdsSum = c1.pdsCap + c2.pdsCap;
      if (volSum >= totalVol && pdsSum >= totalPds) {
        const wasteVol = volSum - totalVol;
        const wastePds = pdsSum - totalPds;
        if (
          !meilleurPair ||
          wasteVol < meilleurPair.wasteVol ||
          (wasteVol === meilleurPair.wasteVol && wastePds < meilleurPair.wastePds)
        ) {
          meilleurPair = { pair: [c1, c2], wasteVol, wastePds };
        }
      }
    }
  }
  if (meilleurPair) {
    const [c1, c2] = meilleurPair.pair;
    return {
      containers:   [c1.code, c2.code],
      capVolume:    c1.volCap + c2.volCap,
      capPoids:     c1.pdsCap + c2.pdsCap,
      resteVolume:  parseFloat(((c1.volCap + c2.volCap) - totalVol).toFixed(6)),
      restePoids:   parseFloat(((c1.pdsCap + c2.pdsCap) - totalPds).toFixed(3))
    };
  }

  // 4. Plusieurs exemplaires du plus grand
  if (list.length === 0) {
    return {
      containers:   [],
      capVolume:    0,
      capPoids:     0,
      resteVolume:  0,
      restePoids:   0,
      error:        "Aucun conteneur disponible dans cette catégorie."
    };
  }
  const largest = list[list.length - 1];
  const nbByVol = Math.ceil(totalVol  / largest.volCap);
  const nbByPds = Math.ceil(totalPds / largest.pdsCap);
  const nbNeeded = Math.max(nbByVol, nbByPds);

  const totalCapVol = largest.volCap * nbNeeded;
  const totalCapPds = largest.pdsCap * nbNeeded;
  return {
    containers:   Array(nbNeeded).fill(largest.code),
    capVolume:    totalCapVol,
    capPoids:     totalCapPds,
    resteVolume:  parseFloat((totalCapVol - totalVol).toFixed(6)),
    restePoids:   parseFloat((totalCapPds - totalPds).toFixed(3))
  };
}

/**
 * formatResultMessage(titreCat, totalVol, totalPds, resultat)
 *   Construit le bloc HTML pour une catégorie (réfrigéré ou sec) :
 *   – titreCat : titre de la section
 *   – totalVol, totalPds : besoins passés à findOptimalContainers
 *   – resultat : objet renvoyé par findOptimalContainers
 */
function formatResultMessage(titreCat, totalVol, totalPds, resultat) {
  let html = `<div class="message categorie">`;
  html += `<div class="message-item titre">${titreCat} :</div>`;

  if (resultat.error) {
    html += `<div class="message-item">⚠️ ${resultat.error}</div>`;
  } else {
    const codes = resultat.containers.join(" + ");
    html += `<div class="message-item">📦 Conteneur(s) sélectionné(s) : <strong>${codes}</strong></div>`;
    html += `<div class="message-item">🔍 Capacité totale : <strong>${resultat.capVolume.toLocaleString("fr-FR", { minimumFractionDigits: 6 })} m³</strong> et <strong>${resultat.capPoids.toLocaleString("fr-FR", { minimumFractionDigits: 3 })} kg</strong></div>`;
    html += `<div class="message-item">⚖️ Besoins totaux : <strong>${totalVol.toLocaleString("fr-FR", { minimumFractionDigits: 6 })} m³</strong> et <strong>${totalPds.toLocaleString("fr-FR", { minimumFractionDigits: 3 })} kg</strong></div>`;
    html += `<div class="message-item">✅ Espace restant : <strong>${resultat.resteVolume.toLocaleString("fr-FR", { minimumFractionDigits: 6 })} m³</strong> et <strong>${resultat.restePoids.toLocaleString("fr-FR", { minimumFractionDigits: 3 })} kg</strong></div>`;
  }

  html += `</div>`;
  return html;
}

/**
 * Injecte le HTML dans la div #message-resultat.
 */
function afficherMessage({ html }) {
  const zone = document.getElementById("message-resultat");
  zone.innerHTML = html;
}
