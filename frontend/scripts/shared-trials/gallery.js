const view = document.querySelector("#view"),
  caseSelect = document.querySelector("#case");
function filter() {
  let count = 0;
  for (const card of document.querySelectorAll("article")) {
    card.hidden =
      (view.value === "latest" && card.dataset.latest !== "true") ||
      (caseSelect.value && caseSelect.value !== card.dataset.case);
    if (!card.hidden) count++;
  }
  document.querySelector("#count").textContent = `${count}候補を表示`;
}
view.addEventListener("change", filter);
caseSelect.addEventListener("change", filter);
filter();
