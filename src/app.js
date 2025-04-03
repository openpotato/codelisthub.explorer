//   Copyright (c) STÜBER SYSTEMS GmbH
//
//   This program is free software: you can redistribute it and/or modify
//   it under the terms of the GNU Affero General Public License, version 3,
//   as published by the Free Software Foundation.
//
//   This program is distributed in the hope that it will be useful,
//   but WITHOUT ANY WARRANTY; without even the implied warranty of
//   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
//   GNU Affero General Public License for more details.
//
//   You should have received a copy of the GNU Affero General Public License
//   along with this program. If not, see <http://www.gnu.org/licenses/>.

class RestApiClient {
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
    }

    getAbsoluteUrl(endpoint, params = {}) {
        const queryString = new URLSearchParams(params).toString();
        const url = queryString ? `${endpoint}?${queryString}` : endpoint;
        return `${this.baseUrl}${url}`;
    }

    async request(absoluteUrl, method, headers) {
        const options = { method, headers };
        try {
            const response = await fetch(absoluteUrl, options);
            if (response.ok) {
                return response;                
            }
            else {
                throw new Error(`HTTP Error ${response.status}: ${response.statusText}`);
            }
        } catch (error) {
            console.error("Fetch error:", error);
            throw error;
        }
    }

    async getJson(endpoint, params = {}) {
        const url = this.getAbsoluteUrl(endpoint, params);
        const response = await this.request(url, "GET", { "Accept": "application/json" });
        return { 
            json: await response.json(), 
            totalPages: parseInt(response.headers.get("x-total-pages")),
            totalCount: parseInt(response.headers.get("x-total-count"))
        }
    }

    async getJsonBlob(endpoint, params = {}) {
        const url = this.getAbsoluteUrl(endpoint, params);
        const response = await this.request(url, "GET", { "Accept": "application/json" });
        return await response.blob();
    }

    async getCsvBlob(endpoint, params = {}) {
        const url = this.getAbsoluteUrl(endpoint, params);
        const response = await this.request(url, "GET", { "Accept": "text/csv" });
        return await response.blob();
    }
}

class UI {
    constructor() {
        this.documentTypeSelector = document.getElementById("documentTypeSelector");
        this.languageSelector = document.getElementById("languageSelector");
        this.publishedFromInput = document.getElementById("publishedFrom");
        this.publishedUntilInput = document.getElementById("publishedUntil");
        this.searchTermInput = document.getElementById("searchTerm");
        this.documentListBody = document.getElementById("documentList")
        this.loadMoreButton = document.getElementById("loadMoreButton");
        this.init();
    }

    init() {
        document.addEventListener("DOMContentLoaded", function() {
            document.getElementById("currentYear").textContent = new Date().getFullYear();
        });
    }

    showOrHideLoadMoreButton(show) {
        this.loadMoreButton.style.display = show == true ? "block" : "none";
    }

    clearDocumentList() {
        this.documentListBody.innerHTML = ``;
    }

    renderDocumentList(documentList) {
        documentList.forEach(doc => {
            const row = `
                <li class="list-group-item d-flex align-items-center justify-content-start">
                    <div class="flex-grow-1 my-2">
                        <div class="d-flex flex-wrap justify-content-between">
                            <div class="d-flex flex-wrap align-items-center justify-content-start">
                                <span class="me-2 fw-bold">${doc.shortName}</span>
                                <span class="ms-1 badge text-bg-secondary">${doc.publisher.shortName}</span>
                                <span class="ms-1 badge text-bg-light">${doc.language}</span>
                                <span class="ms-1 badge text-bg-light">${doc.version}</span>
                                <span class="ms-1 badge text-bg-light">${doc.type}</span>
                            </div>
                            <div>
                                <small class="text-body-tertiary">${doc.canonicalVersionUri}</small>
                            </div>
                        </div>
                        <div class="d-flex flex-wrap justify-content-between gap-2 mt-1 mb-2">
                            <span>${doc.longName}</span>
                            <small>${app.translations.PublishedAt} ${new Date(doc.publishedAt).toLocaleDateString()}</small>
                        </div>
                        <div class="d-flex flex-wrap gap-2">
                                <button type="button" class="btn btn-primary btn-sm" onclick="app.fetchJsonDocument('${doc.canonicalVersionUri}', '${doc.language}', false)">
                                    ${app.translations.DownloadOCL}
                                </button>
                                <button type="button" class="btn btn-primary btn-sm" onclick="app.fetchJsonDocument('${doc.canonicalVersionUri}', '${doc.language}', true)">
                                    ${app.translations.DownloadOCLMeta}
                                </button>
                                ${doc.type === 'CodeList' ? `
                                <button type="button" class="btn btn-primary btn-sm" 
                                    onclick="app.fetchCsvDocument('${doc.canonicalVersionUri}', '${doc.language}')">
                                    ${app.translations.DownloadCSV}
                                </button>
                                <button type="button" class="btn btn-outline-primary btn-sm" 
                                    onclick="app.fetchAndShowCsvDocument('${doc.canonicalVersionUri}', '${doc.language}')">
                                    ${app.translations.ViewCSV}
                                </button>` : ''}
                        </div>
                    </div>
                </li>`;
            this.documentListBody.innerHTML += row;
        });
        if (this.documentListBody.innerHTML == "")
        {
            this.documentListBody.innerHTML = `
                <li class="list-group-item d-flex w-100 align-items-center justify-content-start">
                    ${app.translations.NoDocuments}
                </li>`;
        };
    }
}

class Application {
    constructor(translations) {
        this.translations = translations;
        this.pageSize = 10;
        this.currentPage = 1;
        this.totalPages = 0;
        this.totalCount = 0;
        this.searchTimeout = null;
        this.restApiClient = new RestApiClient("https://api.codelisthub.org/v1")
        this.ui = new UI();
        this.init();
    }

    init() {
        this.ui.documentTypeSelector.addEventListener("change", () => this.resetAndFetchDocumentList());
        this.ui.languageSelector.addEventListener("change", () => this.resetAndFetchDocumentList());
        this.ui.publishedFromInput.addEventListener("change", () => this.resetAndFetchDocumentList());
        this.ui.publishedUntilInput.addEventListener("change", () => this.resetAndFetchDocumentList());
        this.ui.searchTermInput.addEventListener("input", () => this.debouncedSearch());
        this.ui.loadMoreButton.addEventListener("click", () => this.fetchDocumentList());
        this.fetchDocumentList();
    }
    
    downloadDocument(blob) {
        const url = window.URL.createObjectURL(blob);
        window.open(url);
        window.URL.revokeObjectURL(url);
    }

    debouncedSearch() {
        clearTimeout(this.searchTimeout); 
        this.searchTimeout = setTimeout(() => {
            this.resetAndFetchDocumentList();
        }, 500);
    }

    resetAndFetchDocumentList() {
        this.currentPage = 1;
        this.totalPages = 0;
        this.totalCount = 0;
        this.ui.clearDocumentList();
        this.fetchDocumentList();
    }

    async fetchJsonDocument(canonicalVersionUri, language, metaOnly) {
        try {
            const blob = await this.restApiClient.getJsonBlob(`/documents/${encodeURIComponent(canonicalVersionUri)}`, { 
                "language": language, 
                "metaOnly": metaOnly
            });
            this.downloadDocument(blob);
        } catch (error) {
            console.error("Error downloading document:", error);
        }
    }
    
    async fetchCsvDocument(canonicalVersionUri, language) {
        try {
            const blob = await this.restApiClient.getCsvBlob(`/documents/${encodeURIComponent(canonicalVersionUri)}/alternative-format`, { 
                "language": language 
            });
            this.downloadDocument(blob);
        } catch (error) {
            console.error("Error downloading document:", error);
        }
    }

    async fetchAndShowCsvDocument(canonicalVersionUri, language) {
        try {
            
            const blob = await this.restApiClient.getCsvBlob(`/documents/${encodeURIComponent(canonicalVersionUri)}/alternative-format`, { 
                "language": language 
            });
            
            const csvText = await blob.text();

            if (!csvText.trim()) {
                alert("CSV file is empty or couldn't be loaded.");
                return;
            }
    
            const csvHeader = document.getElementById("csvHeader");
            const csvBody = document.getElementById("csvBody");
            csvHeader.innerHTML = "";
            csvBody.innerHTML = "";
    
            Papa.parse(csvText, {
                delimiter: ",", 
                skipEmptyLines: true,
                complete: function (result) {
                    if (result.data.length === 0) {
                        alert("No data found in CSV.");
                        return;
                    }
                    result.data[0].forEach(header => {
                        const th = document.createElement("th");
                        th.textContent = header.trim();
                        csvHeader.appendChild(th);
                    });
                    for (let i = 1; i < result.data.length; i++) {
                        const tr = document.createElement("tr");
                        result.data[i].forEach(cell => {
                            const td = document.createElement("td");
                            td.textContent = cell.trim();
                            tr.appendChild(td);
                        });
                        csvBody.appendChild(tr);
                    }
                }
            });

            const csvModal = new bootstrap.Modal(document.getElementById("csvModal"));
            csvModal.show();

        } catch (error) {
            console.error("Error downloading document:", error);
        }
    }    

    async fetchDocumentList() {
        const documentType = this.ui.documentTypeSelector.value;
        const language = this.ui.languageSelector.value;
        const publishedFrom = this.ui.publishedFromInput.value;
        const publishedUntil = this.ui.publishedUntilInput.value;
        const searchTerm = this.ui.searchTermInput.value.trim();
        try {
            
            const data = await this.restApiClient.getJson("/documents/index", { 
                "type": documentType !== "" ? documentType : "" ,
                "page": this.currentPage,
                "pageSize": this.pageSize,
                "language": language !== "" ? language : "", 
                "publishedFrom": publishedFrom !== "" ? encodeURIComponent(new Date(publishedFrom).toISOString()) : "",
                "publishedUntil": publishedFrom !== "" ? encodeURIComponent(new Date(publishedUntil).toISOString()) : "",
                "searchTerm": searchTerm !== "" ? encodeURIComponent(searchTerm) : ""
            });
    
            this.totalPages = data.totalPages;
            this.totalCount = data.totalCount;
            this.ui.renderDocumentList(data.json);
            this.ui.showOrHideLoadMoreButton(++this.currentPage <= this.totalPages);
            
        } catch (error) {
            console.error("Error fetching documents:", error);
        }
    }
}
