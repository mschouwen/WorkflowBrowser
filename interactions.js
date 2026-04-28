(function () {
    const WorkflowApp = window.WorkflowApp;
    const cy = WorkflowApp.cy;
    const cyContainer = WorkflowApp.cyContainer;

    if (typeof WorkflowApp.state.selectedNode === 'undefined') {
        WorkflowApp.state.selectedNode = null;
    }
    if (typeof WorkflowApp.state.connectionMode === 'undefined') {
        WorkflowApp.state.connectionMode = false;
    }

    const connectionModeBtn = document.getElementById('connectionModeBtn');
    const deleteNodeMenuItem = document.getElementById('deleteNodeMenuItem');
    const saveWorkflowMenuItem = document.getElementById('saveWorkflowMenuItem');

    WorkflowApp.ui.connectionModeBtn = connectionModeBtn;
    WorkflowApp.ui.deleteNodeMenuItem = deleteNodeMenuItem;
    WorkflowApp.ui.saveWorkflowMenuItem = saveWorkflowMenuItem;

    // Function to display node parameters in the bottom panel
    // helper to map datatype to icon HTML, similar to backend get_icon


    // show selection form for connection endpoint in a modal dialog
    function showConnectionForm(edge) {
        const modal = document.getElementById('paramDialog');
        const body = document.getElementById('modalBody');
        body.innerHTML = '';
        const sourceId = edge.data('source');
        const targetId = edge.data('target');
        const targetNode = cy.$(`#${targetId}`);
        const sourceNode = cy.$(`#${sourceId}`);
        if (!targetNode || targetNode.length === 0) {
            body.textContent = 'Target node not found';
        } else {
            const paramsIn = targetNode.data('parameters') || {};
            const paramsOut = sourceNode.data('parameters') || {};

            // Get the output parameter from source node (where input === 'no')
            const outputParam = Object.values(paramsOut).find(param => param && param.input === 'no');
            const outputTypes = outputParam ? outputParam.type.split('|').map(t => t.trim()) : [];

            // Filter to only include input parameters of target node that match the output types
            const paramEntries = Object.entries(paramsIn).filter(([key, param]) => {
                if (!param || !param.name || param.input !== 'yes') {
                    return false;
                }
                // Check if parameter type matches any of the output types
                const paramTypes = param.type ? param.type.split('|').map(t => t.trim()) : [];
                return paramTypes.some(pType => outputTypes.includes(pType));
            });

            const form = document.createElement('form');
            form.innerHTML = `
                    <div class="connection-form-header">Connect to input parameter</div>
                    <h3>${targetNode.data('name') || targetId}</h3>
                    <p class="connection-form-subtitle">Select parameter:</p>
                `;
            paramEntries.forEach(([key, param], index) => {
                const label = document.createElement('label');
                label.className = 'connection-param-option';
                const radio = document.createElement('input');
                radio.type = 'radio';
                radio.name = 'paramSelect';
                radio.value = String(param.index ?? index);
                label.appendChild(radio);
                label.appendChild(document.createTextNode(' ' + param.index + ": " + (param.name || key)));
                form.appendChild(label);
            });
            const actions = document.createElement('div');
            actions.className = 'connection-form-actions';

            const confirmButton = document.createElement('button');
            confirmButton.type = 'button';
            confirmButton.textContent = 'Confirm';
            confirmButton.addEventListener('click', async () => {
                const sel = form.querySelector('input[name="paramSelect"]:checked');
                if (sel) {
                    const paramIndex = parseInt(sel.value);
                    confirmButton.disabled = true;
                    cancelButton.disabled = true;
                    try {
                        // Wait for addconnection response so metadata panel refresh happens after server update.
                        await WorkflowApp.addConnectionToGraph(sourceId, targetId, paramIndex - 1);
                        // Update the target node table: 4th column of the connected row shows the source node index
                        const targetWrapper = cyContainer.querySelector(`[data-node-id="${targetId}"]`);
                        if (targetWrapper) {
                            const row = targetWrapper.querySelector(`tr[data-param-index="${paramIndex}"]`);
                            if (row) {
                                const cells = row.querySelectorAll('td');
                                if (cells.length >= 4) {
                                    cells[3].textContent = String(sourceId);
                                }
                            }
                            // Persist the updated table HTML back into Cytoscape node data
                            const targetCyNode = cy.$(`#${targetId}`);
                            if (targetCyNode.length > 0) {
                                const updatedTable = targetWrapper.querySelector('table');
                                if (updatedTable) {
                                    targetCyNode.data('tableHtml', updatedTable.outerHTML);
                                }
                            }
                        }
                    } catch (error) {
                        console.error('Failed to add connection:', error);
                    } finally {
                        confirmButton.disabled = false;
                        cancelButton.disabled = false;
                    }
                }
                closeModal();
            });

            const cancelButton = document.createElement('button');
            cancelButton.type = 'button';
            cancelButton.textContent = 'Cancel';
            cancelButton.addEventListener('click', () => {
                if (edge && edge.length > 0) {
                    cy.remove(edge);
                }
                closeModal();
            });

            actions.appendChild(confirmButton);
            actions.appendChild(cancelButton);
            form.appendChild(actions);
            body.appendChild(form);
        }
        modal.style.display = 'flex';
    }

    function closeModal() {
        const modal = document.getElementById('paramDialog');
        modal.style.display = 'none';
    }


    connectionModeBtn.addEventListener('click', function () {
        WorkflowApp.setConnectionMode(!WorkflowApp.state.connectionMode);
    });
    // Use Cytoscape's tap event for node clicks - works with HTML labels
    cy.on('tap', 'node', function (evt) {
        const node = evt.target;
        if (node.data('internalNode')) {
            return;
        }

        // Always display parameters when any node is selected
        WorkflowApp.displayNodeParameters(node);
        WorkflowApp.refreshMetadataParametersPanel();

        if (!WorkflowApp.state.connectionMode) return; // Only handle connection logic in connection mode

        if (WorkflowApp.state.selectedNode === null) {
            // First click - select source node with green border
            WorkflowApp.state.selectedNode = node;
            node.style({
                'border-width': 3,
                'border-color': '#00AA00'
            });
        } else if (WorkflowApp.state.selectedNode === node) {
            // Clicking same node - deselect
            node.style({
                'border-width': 0,
                'border-color': ''
            });
            WorkflowApp.state.selectedNode = null;
        } else {
            // Second click - connect to target node
            const sourceNode = WorkflowApp.state.selectedNode;
            const targetNode = node;
            const sourceId = sourceNode.id();
            const targetId = targetNode.id();

            // Show red border briefly on target node
            targetNode.style({
                'border-width': 3,
                'border-color': '#FF0000'
            });

            // Create a unique edge ID
            const edgeId = `edge_${sourceId}_${targetId}_${Date.now()}`;

            // Add the edge to the graph
            const newEdge = cy.add({
                data: {
                    id: edgeId,
                    source: sourceId,
                    target: targetId
                }
            });

            // show parameter selection form for target node
            showConnectionForm(newEdge);

            // Revert borders to normal after 500ms
            setTimeout(function () {
                sourceNode.style({
                    'border-width': 0,
                    'border-color': ''
                });
                targetNode.style({
                    'border-width': 0,
                    'border-color': ''
                });
            }, 500);

            WorkflowApp.state.selectedNode = null;
        }
    });

    // Also handle clicks on HTML label wrappers for connection mode
    cyContainer.addEventListener('click', function (e) {
        const wrapper = e.target.closest('.node-wrapper');
        if (!wrapper) return;

        const nodeId = wrapper.dataset.nodeId;
        const node = cy.$(`#${nodeId}`);
        if (!node || node.length === 0) return;

        // Always display parameters when any node is clicked
        WorkflowApp.displayNodeParameters(node);
        WorkflowApp.refreshMetadataParametersPanel();

        if (!WorkflowApp.state.connectionMode) return;

        if (WorkflowApp.state.selectedNode === null) {
            // Select source node
            WorkflowApp.state.selectedNode = node;
            node.style({
                'border-width': 3,
                'border-color': '#00AA00'
            });
            wrapper.classList.add('selected');
        } else if (WorkflowApp.state.selectedNode === node) {
            // Deselect
            node.style({
                'border-width': 0,
                'border-color': ''
            });
            wrapper.classList.remove('selected');
            WorkflowApp.state.selectedNode = null;
        } else {
            // Connect from selectedNode to this node
            const sourceNode = WorkflowApp.state.selectedNode;
            const targetNode = node;
            const sourceId = sourceNode.id();
            const targetId = targetNode.id();

            wrapper.classList.add('targeted');
            targetNode.style({
                'border-width': 3,
                'border-color': '#FF0000'
            });

            const edgeId = `edge_${sourceId}_${targetId}_${Date.now()}`;

            const newEdge = cy.add({
                data: {
                    id: edgeId,
                    source: sourceId,
                    target: targetId
                }
            });

            // show parameter selection for the target node
            showConnectionForm(newEdge);

            // revert visuals after a short delay
            setTimeout(function () {
                sourceNode.style({
                    'border-width': 0,
                    'border-color': ''
                });
                const prevWrapper = cyContainer.querySelector(`[data-node-id="${sourceId}"]`);
                if (prevWrapper) prevWrapper.classList.remove('selected');
                targetNode.style({
                    'border-width': 0,
                    'border-color': ''
                });
                wrapper.classList.remove('targeted');
            }, 500);

            WorkflowApp.state.selectedNode = null;
        } // end else
    });

    // Implement custom drag for HTML-labeled nodes so dragging moves the node (not the canvas)
    let draggingHtmlNode = null;
    let dragOffset = null;
    let dragStarted = false;
    const DRAG_THRESHOLD = 4; // pixels

    function screenToModel(screenX, screenY) {
        const rect = cyContainer.getBoundingClientRect();
        const relX = screenX - rect.left;
        const relY = screenY - rect.top;
        const pan = cy.pan();
        const zoom = cy.zoom();
        return { x: (relX - pan.x) / zoom, y: (relY - pan.y) / zoom };
    }

    cyContainer.addEventListener('mousedown', function (e) {
        const wrapper = e.target.closest('.node-wrapper');
        if (!wrapper) return;
        if (WorkflowApp.state.connectionMode) return;

        e.preventDefault();

        const nodeId = wrapper.dataset.nodeId;
        const node = cy.$(`#${nodeId}`);
        if (!node || node.length === 0) return;

        draggingHtmlNode = node;
        dragStarted = false;

        const startScreen = { x: e.clientX, y: e.clientY };
        const startModel = screenToModel(startScreen.x, startScreen.y);
        const nodePos = node.position();
        dragOffset = { x: nodePos.x - startModel.x, y: nodePos.y - startModel.y };

        const onMove = function (ev) {
            if (!draggingHtmlNode) return;
            const moveScreen = { x: ev.clientX, y: ev.clientY };
            const dx = moveScreen.x - startScreen.x;
            const dy = moveScreen.y - startScreen.y;

            if (!dragStarted) {
                if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
                dragStarted = true;
                cy.userPanningEnabled(false);
            }

            const modelPos = screenToModel(moveScreen.x, moveScreen.y);
            draggingHtmlNode.position({ x: modelPos.x + dragOffset.x, y: modelPos.y + dragOffset.y });
        };

        const onUp = function () {
            if (dragStarted) {
                cy.userPanningEnabled(true);
            }
            draggingHtmlNode = null;
            dragOffset = null;
            dragStarted = false;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });

    // Touch support: implement touch-based dragging with same offset logic
    cyContainer.addEventListener('touchstart', function (e) {
        const touch = e.touches[0];
        if (!touch) return;
        const wrapper = e.target.closest('.node-wrapper');
        if (!wrapper) return;
        if (WorkflowApp.state.connectionMode) return;

        e.preventDefault();

        const nodeId = wrapper.dataset.nodeId;
        const node = cy.$(`#${nodeId}`);
        if (!node || node.length === 0) return;

        draggingHtmlNode = node;
        dragStarted = false;

        const startScreen = { x: touch.clientX, y: touch.clientY };
        const startModel = screenToModel(startScreen.x, startScreen.y);
        const nodePos = node.position();
        dragOffset = { x: nodePos.x - startModel.x, y: nodePos.y - startModel.y };

        const onTouchMove = function (ev) {
            const t = ev.touches[0];
            if (!t || !draggingHtmlNode) return;
            const moveScreen = { x: t.clientX, y: t.clientY };
            const dx = moveScreen.x - startScreen.x;
            const dy = moveScreen.y - startScreen.y;

            if (!dragStarted) {
                if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
                dragStarted = true;
                cy.userPanningEnabled(false);
            }

            const modelPos = screenToModel(moveScreen.x, moveScreen.y);
            draggingHtmlNode.position({ x: modelPos.x + dragOffset.x, y: modelPos.y + dragOffset.y });
        };

        const onTouchEnd = function () {
            if (dragStarted) {
                cy.userPanningEnabled(true);
            }
            draggingHtmlNode = null;
            dragOffset = null;
            dragStarted = false;
            document.removeEventListener('touchmove', onTouchMove);
            document.removeEventListener('touchend', onTouchEnd);
        };

        document.addEventListener('touchmove', onTouchMove, { passive: false });
        document.addEventListener('touchend', onTouchEnd);
    });

    Object.assign(WorkflowApp, {
        showConnectionForm,
        closeModal,
        screenToModel
    });
})();
