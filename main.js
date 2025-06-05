// main.js

let produits = [];    // Array d'objets produits (contenant Référence, Nom, Poids_unité, Volume_unité, Refrigerer, ...)
let conteneurs = [];  // Array d'objets conteneurs (contenant "NAME ", "ID ", Poids_max, Capacite_plus_de_quatre, Capacite_quatre_ou_moins, ...)

/**
 * Au chargement de la page : on récupère les JSON et on génère le tableau.
 */
window.addEventListener("DOMContentLoaded", async () => {
  try {
    const [respP, respC] = await Promise.all([
      fetch("produits.json"),
      fetch("conteneurs.json"),
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
 * Génère le <tbody> du tableau produits.
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
      <td><input type="number" id="quantite-${i}" min="0" step="1" value="0" style="width: 60px;"></td>
    `;
    tbody.appendChild(tr);
  });
}

/**
 * Lorsque l’utilisateur clique sur “Calculer”, on sépare réfrigérés / secs, on calcule les besoins,
 * puis on appelle findOptimalContainers() pour chaque catégorie et on affiche le résultat.
 */
function traiterCalcul() {
  // 1. Calculer les totaux réfrigérés et secs
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

  const messages = [];

  // 2. Si on a des produits réfrigérés : filtrer les conteneurs réfrigérés et trouver le(s) optimal(aux)
  if (totalRefVol > 0 || totalRefPds > 0) {
    const contRef = conteneurs.filter(c => {
      const code = (c["NAME "] || "").trim();
      return code === "TC20R" || code === "TC40R" || code === "TC40HCR";
    });
    const resultatRef = findOptimalContainers(totalRefVol, totalRefPds, contRef);
    messages.push(formatResultMessage("Produits réfrigérés", totalRefVol, totalRefPds, resultatRef));
  }

  // 3. Si on a des produits secs : filtrer tous les autres conteneurs (non-R) et trouver le(s) optimal(aux)
  if (totalDryVol > 0 || totalDryPds > 0) {
    const contDry = conteneurs.filter(c => {
      const code = (c["NAME "] || "").trim();
      return code !== "TC20R" && code !== "TC40R" && code !== "TC40HCR";
    });
    const resultatDry = findOptimalContainers(totalDryVol, totalDryPds, contDry);
    messages.push(formatResultMessage("Produits non réfrigérés", totalDryVol, totalDryPds, resultatDry));
  }

  // 4. Si aucune quantité n’a été entrée (somme de tous les volumes/poids est zéro), on affiche “Aucune quantité saisie.”
  if (totalRefVol + totalRefPds + totalDryVol + totalDryPds === 0) {
    afficherMessage({
      html: `<div class="message"><em>Aucune quantité saisie.</em></div>`
    });
  } else {
    afficherMessage({ html: messages.join("") });
  }
}

/**
 * findOptimalContainers(totalVol, totalPds, availableContainers) :
 *   - totalVol, totalPds : besoins à couvrir.
 *   - availableContainers : array d’objets { "NAME ", "Poids_max", "Capacite_plus_de_quatre", … }.
 *
 * On renvoie un objet { containers, capVolume, capPoids, resteVolume, restePoids, error? }.
 * - containers : tableau de codes (ex. ["TC20R", "TC40R"] ou ["TC20R", "TC20R"] si besoin de 2 x TC20R).
 * - capVolume : somme des capacités volume des conteneurs choisis.
 * - capPoids  : somme des capacités poids.
 * - resteVolume, restePoids : capVolume – besoins.
 * - error (optionnel) : si aucun conteneur dispo pour cette catégorie.
 */
function findOptimalContainers(totalVol, totalPds, availableContainers) {
  // 1. Construire un tableau { code, volCap, pdsCap } et le trier par volCap croissant (puis pdsCap)
  const list = availableContainers
    .map(c => ({
      code:   (c["NAME "]  || "").trim(),
      volCap: parseFloat(c["Capacite_plus_de_quatre"]),
      pdsCap: parseFloat(c["Poids_max"])
    }))
    .filter(c => c.code && !isNaN(c.volCap) && !isNaN(c.pdsCap))
    .sort((a, b) => {
      if (a.volCap !== b.volCap) return a.volCap - b.volCap;
      return a.pdsCap - b.pdsCap;
    });

  // 2. Essayer un CONTENEUR UNIQUE : on choisit celui qui minimise en priorité le gaspillage de VOLUME,
  //    puis en cas d’égalité, le gaspillage de POIDS.
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

  // 3. Essayer la PAIRE DE CONTENEURS qui minimise d’abord le gaspillage de VOLUME cumulé,
  //    puis en cas d’égalité, le gaspillage de POIDS cumulé.
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
          meilleurPair = {
            pair:     [c1, c2],
            wasteVol,
            wastePds
          };
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

  // 4. Si on arrive ici, aucun conteneur unique NI aucune paire ne suffit.  
  //    On prend donc N exemplaires du PLUS GRAND conteneur de la liste pour couvrir volume ET poids.
  if (list.length === 0) {
    return {
      containers: [],
      capVolume: 0,
      capPoids:  0,
      resteVolume: 0,
      restePoids:  0,
      error: "Aucun conteneur disponible dans cette catégorie."
    };
  }
  const largest = list[list.length - 1];
  const nbByVol = Math.ceil(totalVol  / largest.volCap);
  const nbByPds = Math.ceil(totalPds / largest.pdsCap);
  const nbNeeded = Math.max(nbByVol, nbByPds);

  const totalCapVol = largest.volCap * nbNeeded;
  const totalCapPds = largest.pdsCap * nbNeeded;
  return {
    containers:    Array(nbNeeded).fill(largest.code),
    capVolume:     totalCapVol,
    capPoids:      totalCapPds,
    resteVolume:   parseFloat((totalCapVol - totalVol).toFixed(6)),
    restePoids:    parseFloat((totalCapPds - totalPds).toFixed(3))
  };
}

/**
 * formatResultMessage(titreCat, totalVol, totalPds, resultat)
 * Construit le bloc HTML pour une catégorie donnée :
 *    - titreCat : "Produits réfrigérés" ou "Produits non réfrigérés"
 *    - totalVol, totalPds : besoins à couvrir
 *    - resultat      : l’objet renvoyé par findOptimalContainers(...)
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
 * Affiche le HTML complet dans la div #message-resultat.
 */
function afficherMessage({ html }) {
  const zone = document.getElementById("message-resultat");
  zone.innerHTML = html;
}
