// Global JSON string representing the graph state (nodes & connections)
const WorkflowApp = window.WorkflowApp = window.WorkflowApp || {};
WorkflowApp.state = WorkflowApp.state || {};
WorkflowApp.ui = WorkflowApp.ui || {};

let workflow_id = -1;
let graphJson = null; // Will be initialized once workflow_id is set from server
let workflowInitialized = false; // Flag to prevent re-initialization
let metadataParameterValues = {};
let metadataParameters = null;
const CHOICE_DEFAULT_WIDTH = 520;
const CHOICE_DEFAULT_HEIGHT = 360;
const CHOICE_MIN_WIDTH = 260;
const CHOICE_MIN_HEIGHT = 180;

WorkflowApp.CHOICE_DEFAULT_WIDTH = CHOICE_DEFAULT_WIDTH;
WorkflowApp.CHOICE_DEFAULT_HEIGHT = CHOICE_DEFAULT_HEIGHT;
WorkflowApp.CHOICE_MIN_WIDTH = CHOICE_MIN_WIDTH;
WorkflowApp.CHOICE_MIN_HEIGHT = CHOICE_MIN_HEIGHT;

// Fetch and initialize workflow_id from server
async function initializeWorkflow() {
    try {
        const response = await fetch('/api/workflow-id');
        const data = await response.json();

        if (data.workflow_id !== undefined) {
            workflow_id = data.workflow_id;
            // Initialize graphJson now that we have the real workflow_id
            graphJson = JSON.stringify({ workflow_id: workflow_id, mnodes: [], connections: [] });
            workflowInitialized = true;
        }
    } catch (error) {
        console.error('Error initializing workflow:', error);
        // Fallback: initialize with default -1
        graphJson = JSON.stringify({ workflow_id: workflow_id, mnodes: [], connections: [] });
        workflowInitialized = true;
    }
}

// Send graph state to server
async function sendGraphToServer(action) {
    if (!workflowInitialized || !graphJson) {
        await initializeWorkflow();
        if (!workflowInitialized || !graphJson) {
            return null;
        }
    }
    try {
        const response = await fetch('/api/graph', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...JSON.parse(graphJson), action })
        });
        const data = await response.json();
        metadataParameters = data?.metadata?.parameters || null;
        metadataParameterValues = data?.parameter_values && typeof data.parameter_values === 'object'
            ? data.parameter_values
            : {};
        WorkflowApp.displayMetadataParameters(metadataParameters, metadataParameterValues);
        return data
    } catch (error) {
        console.error('Error sending graph to server:', error);
    }
}

async function refreshMetadataParametersPanel() {
    if (!workflowInitialized) {
        await initializeWorkflow();
    }

    if (workflow_id === -1) {
        return;
    }

    try {
        const response = await fetch(`/api/workflow-metadata?workflow_id=${encodeURIComponent(String(workflow_id))}`);
        const data = await response.json();

        if (!response.ok || data.status !== 'success') {
            throw new Error(data.message || 'Failed to refresh metadata');
        }

        metadataParameters = data?.metadata?.parameters || null;
        metadataParameterValues = data?.parameter_values && typeof data.parameter_values === 'object'
            ? data.parameter_values
            : {};

        WorkflowApp.displayMetadataParameters(metadataParameters, metadataParameterValues);
    } catch (error) {
        console.error('Error refreshing metadata panel:', error);
    }
}

// Utility for updating the global JSON string from an object
function updateGraphJson(obj, action) {
    if (!workflowInitialized) {
        console.warn('Cannot update graph: workflow not yet initialized');
        return null;
    }
    graphJson = JSON.stringify(obj);
    return sendGraphToServer(action);
}

// Add a node by its operation id and return the server-assigned node id
async function addNodeToGraph(operationid) {
    const response = await updateGraphJson({ workflow_id: workflow_id, id: operationid }, "addnode");

    let resolvedNodeId = String(response.node_id);
    return resolvedNodeId;
}

// Remove a node and any related connections
function removeNodeFromGraph(id) {
    updateGraphJson({ workflow_id: workflow_id, id: id }, "removenode");
}

// Add a connection defined by source node, target node and parameter index
async function addConnectionToGraph(sourceId, targetId, paramIndex) {
    const response = await updateGraphJson({ workflow_id: workflow_id, source: sourceId, target: targetId, paramOutIndex: 0, paramInIndex: paramIndex, }, "addconnection");
    return response;
}

// Remove a connection by matching source, target and parameter index
function removeConnectionFromGraph(sourceId, targetId, paramIndex) {
    const obj = JSON.parse(graphJson);
    obj.connections = obj.connections.filter(c => !(c.source === sourceId && c.target === targetId && c.paramIndex === paramIndex));
    updateGraphJson(obj, "removeconnection");
}

function resetNodeParametersPanel() {
    const parametersContainer = document.getElementById('parametersContainer');
    const titleElem = document.getElementById('parametersTitle');
    const displayInput = document.getElementById('displayNameInput');

    if (parametersContainer) {
        parametersContainer.dataset.nodeId = '';
        parametersContainer.innerHTML = '<p class="empty-state-text">No node selected</p>';
    }

    if (titleElem) {
        titleElem.textContent = 'No operation';
    }

    if (displayInput) {
        displayInput.value = '';
    }
}

function setConnectionMode(nextMode) {
    WorkflowApp.state.connectionMode = Boolean(nextMode);
    const connectionMode = WorkflowApp.state.connectionMode;
    const connectionModeBtn = WorkflowApp.ui.connectionModeBtn;

    if (!connectionModeBtn) {
        return;
    }

    connectionModeBtn.classList.toggle('active', connectionMode);
    connectionModeBtn.setAttribute('aria-pressed', connectionMode ? 'true' : 'false');

    if (connectionMode) {
        cy.nodes().ungrabify();
    } else {
        cy.nodes().grabify();
    }

    const selectedNode = WorkflowApp.state.selectedNode;
    if (!connectionMode && selectedNode) {
        selectedNode.style({
            'border-width': 0,
            'border-color': ''
        });
        const selectedWrapper = cyContainer.querySelector(`[data-node-id="${selectedNode.id()}"]`);
        if (selectedWrapper) {
            selectedWrapper.classList.remove('selected');
            selectedWrapper.classList.remove('targeted');
        }
        WorkflowApp.state.selectedNode = null;
    }
}

function downloadWorkflowJson() {
    if (!graphJson) {
        return;
    }

    const blob = new Blob([graphJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `workflow-${workflow_id}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function deleteActiveNode() {
    const parametersContainer = document.getElementById('parametersContainer');
    const nodeId = parametersContainer?.dataset?.nodeId || '';
    if (!nodeId) {
        return;
    }

    const node = cy.$(`#${nodeId}`);
    if (!node || node.length === 0) {
        resetNodeParametersPanel();
        return;
    }

    if (WorkflowApp.state.selectedNode && WorkflowApp.state.selectedNode.id() === nodeId) {
        WorkflowApp.state.selectedNode = null;
    }

    if (!node.data('localOnly')) {
        removeNodeFromGraph(nodeId);
    }

    if (node.hasClass('choice-compound')) {
        const headerNode = cy.$(`#${nodeId}_header`);
        if (headerNode && headerNode.length > 0) {
            cy.remove(headerNode);
        }

        const resizeNode = cy.$(`#${nodeId}_resize`);
        if (resizeNode && resizeNode.length > 0) {
            cy.remove(resizeNode);
        }
    }

    cy.remove(node);
    resetNodeParametersPanel();
}

function applySidebarFilter() {
    const filterInput = document.getElementById('itemFilterInput');
    const itemList = document.getElementById('itemList');
    if (!itemList) {
        return;
    }

    const query = String(filterInput?.value || '').trim().toLowerCase();
    const items = Array.from(itemList.querySelectorAll('li'));

    items.forEach((item) => {
        const itemName = String(item.dataset.itemLabel || item.textContent || '').toLowerCase();
        item.style.display = !query || itemName.includes(query) ? '' : 'none';
    });
}

function createSidebarLabelContent(label) {
    const wrapper = document.createElement('span');
    wrapper.className = 'sidebar-syntax-label';

    const text = String(label || '').trim();
    const openParen = text.indexOf('(');

    const namePart = document.createElement('span');
    namePart.className = 'sidebar-op-name';

    const paramsPart = document.createElement('span');
    paramsPart.className = 'sidebar-op-params';

    if (openParen > 0 && text.endsWith(')')) {
        namePart.textContent = text.substring(0, openParen);
        paramsPart.textContent = text.substring(openParen);
    } else {
        namePart.textContent = text;
    }

    wrapper.appendChild(namePart);
    if (paramsPart.textContent) {
        wrapper.appendChild(paramsPart);
    }

    return wrapper;
}

// Load sidebar items from server
async function loadSidebarItems() {
    try {
        const response = await fetch('/api/sidebar');
        const data = await response.json();
        const itemList = document.getElementById('itemList');
        itemList.innerHTML = '';

        data.items.forEach(item => {
            if (!item || typeof item !== 'object') {
                return;
            }

            const name = String(item.name || '').trim();
            const number = String(item.id || '').trim();
            const label = String(item.label || name || '').trim();

            if (!label || !number) {
                return;
            }

            const li = document.createElement('li');
            li.dataset.itemName = name;
            li.dataset.itemLabel = label;
            li.dataset.itemNumber = number;
            li.draggable = true;
            li.appendChild(createSidebarLabelContent(label));
            itemList.appendChild(li);
        });

        // Re-attach drag event listeners after items are loaded
        attachDragListeners();
        applySidebarFilter();
    } catch (error) {
        console.error('Error loading sidebar items:', error);
    }
}

// Drag & Drop handlers
const canvas = document.getElementById('cy');
// Use a consistent name for the Cytoscape container used elsewhere
const cyContainer = canvas;
let draggedItem = null;

function attachMenuDragListeners() {
    const menuItems = document.querySelectorAll('.ribbon-drag-item[draggable="true"]');

    menuItems.forEach((item) => {
        item.addEventListener('dragstart', (e) => {
            draggedItem = item.dataset.itemName || '';
            item.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'copy';
            e.dataTransfer.setData('text/plain', draggedItem);
            e.dataTransfer.setData('application/json', JSON.stringify({
                name: item.dataset.itemName || '',
                label: item.dataset.itemLabel || item.dataset.itemName || '',
                kind: item.dataset.itemKind || '',
                customType: item.dataset.itemType || ''
            }));
        });

        item.addEventListener('dragend', () => {
            item.classList.remove('dragging');
            draggedItem = null;
        });
    });
}

function createCustomNodeTableHtml(nodeId, label, customType) {
    const detailLabel = customType === 'choicejunction' ? 'Choice junction' : 'Choice';
    return `<table class="node-table">
                <tr class="header"><td colspan="2">${WorkflowApp.escapeHtml(nodeId)}: ${WorkflowApp.escapeHtml(label)}</td></tr>
                <tr><td>Kind</td><td>${WorkflowApp.escapeHtml(detailLabel)}</td></tr>
            </table>`;
}


function attachDragListeners() {
    const itemList = document.getElementById('itemList');

    // Remove old listeners by cloning
    const newItemList = itemList.cloneNode(false);
    newItemList.innerHTML = itemList.innerHTML;
    itemList.parentNode.replaceChild(newItemList, itemList);

    // Add drag event listeners to items
    newItemList.addEventListener('dragstart', (e) => {
        const item = e.target.closest('li');
        if (item) {
            draggedItem = item.dataset.itemName; // Use parsed name only
            item.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'copy';
            // Set both name and number in data transfer for flexibility
            e.dataTransfer.setData('text/plain', draggedItem);
            e.dataTransfer.setData('application/json', JSON.stringify({
                name: item.dataset.itemName,
                number: item.dataset.itemNumber
            }));
        }
    });

    newItemList.addEventListener('dragend', (e) => {
        const item = e.target.closest('li');
        if (item) {
            item.classList.remove('dragging');
            draggedItem = null;
        }
    });
}

// Load sidebar items when page loads
document.addEventListener('DOMContentLoaded', async function () {
    // Initialize workflow_id first before doing anything else
    await initializeWorkflow();
    // Load sidebar items and refresh metadata panel in parallel
    loadSidebarItems();
    attachMenuDragListeners();
    refreshMetadataParametersPanel();

    const filterInput = document.getElementById('itemFilterInput');
    if (filterInput) {
        filterInput.addEventListener('input', applySidebarFilter);
    }
});



// Canvas drop zone handlers
canvas.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    canvas.classList.add('dragover');
});

canvas.addEventListener('dragleave', (e) => {
    if (e.target === canvas) {
        canvas.classList.remove('dragover');
    }
});

canvas.addEventListener('drop', (e) => {
    e.preventDefault();
    canvas.classList.remove('dragover');

    const droppedJson = e.dataTransfer.getData('application/json');
    let droppedItem = null;

    if (droppedJson) {
        try {
            droppedItem = JSON.parse(droppedJson);
        } catch (err) {
            console.warn('Could not parse dropped item JSON payload:', err);
        }
    }

    const item = droppedItem?.name || e.dataTransfer.getData('text/plain');
    const itemNumber = droppedItem?.number || '';
    const itemKind = String(droppedItem?.kind || 'operation').trim();
    const customType = String(droppedItem?.customType || '').trim();
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const pan = cy.pan();
    const zoom = cy.zoom();
    const modelX = (x - pan.x) / zoom;
    const modelY = (y - pan.y) / zoom;

    if (itemKind === 'custom-node') {
        WorkflowApp.addCustomNodeToCanvas(customType, droppedItem?.label || item, { x: modelX, y: modelY });
        return;
    }

    // Send drop event to server
    fetch('/api/drop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            item: item,
            itemNumber: itemNumber,
            position: { x: modelX, y: modelY }
        })
    })
        .then(response => response.json())
        .then(async data => {
            // Add the new node to the Cytoscape graph
            if (data.node) {
                let operationid = String(data.node.operation_id);
                let nodeId = String(data.node.id ?? data.node.operation_id ?? `node_${Date.now()}`);

                try {
                    // Request server-side creation first so we can use canonical node id in Cytoscape.
                    nodeId = await addNodeToGraph(operationid);
                } catch (err) {
                    console.error('Failed to resolve node id from server, using fallback id:', err);
                }

                const added = cy.add({
                    data: {
                        id: nodeId,
                        operationid: data.node.operation_id,
                        name: data.node.name,
                        type: data.node.type,
                        tableHtml: data.node.tableHtml,
                        parameters: data.node.parameters  // Include parameters in the node data
                    },
                    position: {
                        x: data.node.x,
                        y: data.node.y
                    }
                });

                // Ensure the newly added node is grab-able (draggable)
                try {
                    added.grabify();
                } catch (err) {
                    console.warn('Could not grabify added node:', err);
                }

                WorkflowApp.assignNodeToChoiceCompoundIfNeeded(added);

                // Update node dimensions with polling to wait for HTML to render
                updateNodeDimensionsWithPolling(nodeId);

                // Fit the graph to view after a reasonable delay
                setTimeout(() => cy.fit(), 2000);


            }
        })
        .catch(error => console.error('Drop error:', error));
});

var cy = cytoscape({
    container: document.getElementById('cy'),
    elements: [],
    style: [
        {
            selector: 'node',
            style: {
                'width': 90,
                'height': 60,
                'shape': 'round-rectangle',
                'background-opacity': 0,
                'border-width': 1,
                'border-color': '#cccccc'
            }
        },
        {
            selector: 'node.choice-compound',
            style: {
                'shape': 'round-rectangle',
                'background-color': '#f6fbff',
                'background-opacity': 0.95,
                'border-width': 2,
                'border-color': '#7ea4c9',
                'width': 520,
                'height': 360,
                'min-width': 260,
                'min-height': 180,
                'padding': 14
            }
        },
        {
            selector: 'node.choice-header',
            style: {
                'shape': 'round-rectangle',
                'background-color': '#dbeaf8',
                'background-opacity': 1,
                'border-width': 1,
                'border-color': '#7ea4c9',
                'events': 'no',
                'z-compound-depth': 'top',
                'z-index-compare': 'manual',
                'z-index': 500
            }
        },
        {
            selector: 'node.choice-resize-handle',
            style: {
                'shape': 'rectangle',
                'background-color': '#ff8a00',
                'background-opacity': 1,
                'border-width': 2,
                'border-color': '#8a4600',
                'z-compound-depth': 'top',
                'z-index-compare': 'manual',
                'z-index': 1200
            }
        },
        {
            selector: 'node:selected',
            style: {
                'overlay-color': '#cccccc',
                'overlay-opacity': 0.3,
                'overlay-padding': 5
            }
        },
        {
            selector: 'edge',
            style: {
                'curve-style': 'bezier',
                'target-arrow-shape': 'triangle',
                'target-arrow-color': '#333',
                'line-color': '#666',
                'width': 2,
                'source-distance-from-node': '5px',
                'target-distance-from-node': '15px',
                'arrow-scale': 1.5
            }
        }
    ],
    layout: { name: 'breadthfirst', padding: 1 }
});

function getNodeHeaderText(data) {
    const nodeName = data.name || '';
    return `${data.id}: ${nodeName}`;
}

function withPrefixedNodeHeader(data) {
    if (!data.tableHtml) {
        return '';
    }

    const wrapper = document.createElement('div');
    wrapper.innerHTML = data.tableHtml;
    const headerCell = wrapper.querySelector('tr.header td');

    if (headerCell) {
        headerCell.textContent = getNodeHeaderText(data);
    }

    return wrapper.innerHTML;
}

// Initialize the HTML Label extension
cy.nodeHtmlLabel([
    {
        query: 'node', // Apply to all nodes
        halign: 'center',
        valign: 'center',
        halignBox: 'center',
        valignBox: 'center',
        tpl: function (data) {
            if (data.name === 'choice-header') {
                return '<div class="choice-header-label">If(...)</div>';
            }

            // Use server-generated table HTML
            if (data.tableHtml) {
                return `<div class="node-wrapper" data-node-id="${data.id}">${withPrefixedNodeHeader(data)}</div>`;
            } else if (data.type === 'operation') {
                // Fallback for nodes without pre-generated HTML (initial nodes)
                return `<div class="node-wrapper" data-node-id="${data.id}">
                            <table class="node-table">
                                <tr class="header"><td colspan="2">${getNodeHeaderText(data)}</td></tr>
                                <tr><td>CPU</td><td>${data.cpu}</td></tr>
                                <tr><td>RAM</td><td>${data.ram}</td></tr>
                            </table>
                        </div>`;
            }
        }
    }
]);

// Function to update node dimensions based on table size with polling
function updateNodeDimensionsWithPolling(nodeId, maxAttempts = 20, interval = 100) {
    const node = cy.$(`#${nodeId}`);
    const wrapper = cyContainer.querySelector(`[data-node-id="${nodeId}"]`);

    if (!wrapper || node.length === 0) {
        console.warn(`Node ${nodeId} not found`);
        return;
    }

    let attempts = 0;

    function poll() {
        attempts++;
        const table = wrapper.querySelector('.node-table');

        if (table) {
            const width = table.offsetWidth;
            const height = table.offsetHeight;

            // If we have valid dimensions, update the node
            if (width > 0 && height > 0) {
                node.style({
                    'width': width + 10,
                    'height': height + 10
                });
                return;
            }
        }

        // Keep polling until we get valid dimensions or hit max attempts
        if (attempts < maxAttempts) {
            setTimeout(poll, interval);
        } else {
            console.warn(`Failed to get valid dimensions for node ${nodeId} after ${maxAttempts} attempts`);
        }
    }

    // Start polling
    poll();
}

// Watch for changes to the canvas and update node sizes
const resizeObserver = new ResizeObserver(() => {
    cy.nodes().forEach(node => {
        updateNodeDimensionsWithPolling(node.id());
    });
});
// modal close button handler
document.addEventListener('DOMContentLoaded', () => {
    const closeBtn = document.getElementById('modalClose');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => WorkflowApp.closeModal && WorkflowApp.closeModal());
    }
    // also close when clicking outside content
    const modal = document.getElementById('paramDialog');
    modal.addEventListener('click', (e) => {
        if (e.target === modal && WorkflowApp.closeModal) WorkflowApp.closeModal();
    });
});
resizeObserver.observe(cyContainer);

// Update dimensions after nodes are rendered
cy.on('add', 'node', function (evt) {
    if (evt.target.data('internalNode')) {
        return;
    }
    updateNodeDimensionsWithPolling(evt.target.id());
});

// If a node is dropped/moved inside a choice compound, make it a child of that compound.
cy.on('dragfree', 'node', function (evt) {
    WorkflowApp.assignNodeToChoiceCompoundIfNeeded(evt.target);

    const parentCompound = evt.target.parent();
    if (parentCompound && parentCompound.length > 0 && parentCompound.hasClass('choice-compound')) {
        syncChoiceAttachments(parentCompound);
    }
});

Object.defineProperties(WorkflowApp.state, {
    workflow_id: {
        get: () => workflow_id,
        set: (value) => { workflow_id = value; },
        configurable: true
    },
    graphJson: {
        get: () => graphJson,
        set: (value) => { graphJson = value; },
        configurable: true
    },
    workflowInitialized: {
        get: () => workflowInitialized,
        set: (value) => { workflowInitialized = value; },
        configurable: true
    },
    metadataParameterValues: {
        get: () => metadataParameterValues,
        set: (value) => { metadataParameterValues = value; },
        configurable: true
    },
    metadataParameters: {
        get: () => metadataParameters,
        set: (value) => { metadataParameters = value; },
        configurable: true
    }
});

WorkflowApp.cy = cy;
WorkflowApp.cyContainer = cyContainer;
WorkflowApp.canvas = canvas;

Object.assign(WorkflowApp, {
    initializeWorkflow,
    refreshMetadataParametersPanel,
    sendGraphToServer,
    updateGraphJson,
    addNodeToGraph,
    removeNodeFromGraph,
    addConnectionToGraph,
    removeConnectionFromGraph,
    resetNodeParametersPanel,
    setConnectionMode,
    downloadWorkflowJson,
    deleteActiveNode,
    applySidebarFilter,
    createSidebarLabelContent,
    loadSidebarItems,
    attachMenuDragListeners,
    createCustomNodeTableHtml,
    attachDragListeners,
    getNodeHeaderText,
    withPrefixedNodeHeader,
    updateNodeDimensionsWithPolling
});

