(function () {
    const cy = window.WorkflowApp.cy;

    function addChoiceCompoundToCanvas(label, position) {
        const nodeLabel = String(label || 'Add Choice').trim() || 'Add Choice';
        const nodeId = `choice_${Date.now()}`;
        const headerId = `${nodeId}_header`;
        const resizeHandleId = `${nodeId}_resize`;
        const allowsChildren = true;

        const parentNode = cy.add({
            data: {
                id: nodeId,
                name: nodeLabel,
                type: 'custom-node',
                customType: 'choice',
                allowsChildren: allowsChildren,
                localOnly: true,
                parameters: {}
            },
            classes: 'choice-compound',
            position: position
        });

        cy.add({
            data: {
                id: headerId,
                attachedTo: nodeId,
                name: 'choice-header',
                type: 'custom-node',
                localOnly: true,
                internalNode: true,
                parameters: {}
            },
            classes: 'choice-header',
            position: {
                x: position.x,
                y: position.y
            }
        });

        cy.add({
            data: {
                id: resizeHandleId,
                attachedTo: nodeId,
                name: 'choice-resize-handle',
                type: 'custom-node',
                localOnly: true,
                internalNode: true,
                parameters: {}
            },
            classes: 'choice-resize-handle',
            position: {
                x: position.x,
                y: position.y
            }
        });

        syncChoiceAttachments(parentNode);
        requestAnimationFrame(() => syncChoiceAttachments(parentNode));

        try {
            parentNode.grabify();
        } catch (err) {
            console.warn('Could not grabify added choice compound node:', err);
        }
    }

    function getChoiceCompoundDimensions(compoundNode) {
        const defaultWidth = Number(WorkflowApp.CHOICE_DEFAULT_WIDTH || 520);
        const defaultHeight = Number(WorkflowApp.CHOICE_DEFAULT_HEIGHT || 360);
        const minWidth = Number(WorkflowApp.CHOICE_MIN_WIDTH || 260);
        const minHeight = Number(WorkflowApp.CHOICE_MIN_HEIGHT || 180);
        const width = Number(compoundNode.width() || defaultWidth);
        const height = Number(compoundNode.height() || defaultHeight);
        return {
            width: Math.max(minWidth, width),
            height: Math.max(minHeight, height)
        };
    }

    function syncChoiceResizeHandle(compoundNode) {
        if (!compoundNode || compoundNode.length === 0) {
            return;
        }

        const handleNode = cy.$(`#${compoundNode.id()}_resize`);
        if (!handleNode || handleNode.length === 0) {
            return;
        }

        const compoundPos = compoundNode.position();
        const dims = getChoiceCompoundDimensions(compoundNode);
        const handleSize = 18;
        const handleOutset = (handleSize / 2) - 2;
        const handleCenterX = compoundPos.x + (dims.width / 2) + handleOutset;
        const handleCenterY = compoundPos.y + (dims.height / 2) + handleOutset;

        handleNode.unlock();
        handleNode.style({
            'width': handleSize,
            'height': handleSize
        });
        handleNode.position({ x: handleCenterX, y: handleCenterY });
        handleNode.grabify();
    }

    function syncChoiceHeader(compoundNode) {
        if (!compoundNode || compoundNode.length === 0) {
            return;
        }

        const headerNode = cy.$(`#${compoundNode.id()}_header`);
        if (!headerNode || headerNode.length === 0) {
            return;
        }

        const headerHeight = 25;
        const compoundPos = compoundNode.position();
        const dims = getChoiceCompoundDimensions(compoundNode);
        const headerWidth = Math.max(80, dims.width);
        const headerCenterY = compoundPos.y - (dims.height / 2) - (headerHeight / 2);

        headerNode.unlock();
        headerNode.style({
            'width': headerWidth,
            'height': headerHeight
        });
        headerNode.position({ x: compoundPos.x, y: headerCenterY });
        headerNode.lock();
        headerNode.ungrabify();
    }

    function syncChoiceAttachments(compoundNode) {
        syncChoiceHeader(compoundNode);
        syncChoiceResizeHandle(compoundNode);
    }

    function addCustomNodeToCanvas(customType, label, position) {
        const normalizedType = String(customType || '').trim().toLowerCase();
        const nodeType = normalizedType || 'choice';
        const nodeLabel = String(label || 'Custom node').trim() || 'Custom node';

        if (nodeType === 'choice') {
            addChoiceCompoundToCanvas(nodeLabel, position);
            return;
        }

        const nodeId = `${nodeType}_${Date.now()}`;
        const tableHtml = WorkflowApp.createCustomNodeTableHtml(nodeId, nodeLabel, nodeType);

        const added = cy.add({
            data: {
                id: nodeId,
                name: nodeLabel,
                type: 'custom-node',
                customType: nodeType,
                localOnly: true,
                tableHtml: tableHtml,
                parameters: {}
            },
            position: position
        });

        try {
            added.grabify();
        } catch (err) {
            console.warn('Could not grabify added custom node:', err);
        }

        WorkflowApp.updateNodeDimensionsWithPolling(nodeId);
        assignNodeToChoiceCompoundIfNeeded(added);
    }

    function findChoiceCompoundForNodePosition(node) {
        if (!node || node.length === 0) {
            return null;
        }

        const nodeId = node.id();
        const nodePosition = node.position();
        let matched = null;

        cy.nodes('.choice-compound').forEach((candidate) => {
            if (matched || candidate.id() === nodeId) {
                return;
            }

            if (candidate.data('allowsChildren') !== true) {
                return;
            }

            if (candidate.descendants().some((descendant) => descendant.id() === nodeId)) {
                return;
            }

            const bb = candidate.boundingBox();
            const inside = nodePosition.x >= bb.x1 && nodePosition.x <= bb.x2
                && nodePosition.y >= bb.y1 && nodePosition.y <= bb.y2;

            if (inside) {
                matched = candidate;
            }
        });

        return matched;
    }

    function assignNodeToChoiceCompoundIfNeeded(node) {
        if (!node || node.length === 0) {
            return;
        }

        if (node.data('internalNode') || node.hasClass('choice-compound')) {
            return;
        }

        const existingParent = node.parent().length > 0 ? node.parent() : null;
        const existingChoiceParent = existingParent && existingParent.hasClass('choice-compound')
            ? existingParent
            : null;
        const targetCompound = findChoiceCompoundForNodePosition(node) || existingChoiceParent;
        if (!targetCompound) {
            return;
        }

        if (!existingParent || existingParent.id() !== targetCompound.id()) {
            node.move({ parent: targetCompound.id() });
        }

        moveNodeToChoiceSafeArea(node, targetCompound);
        syncChoiceAttachments(targetCompound);
    }

    function moveNodeToChoiceSafeArea(node, compound) {
        if (!node || node.length === 0 || !compound || compound.length === 0) {
            return;
        }

        const nodePos = node.position();
        const parentPos = compound.position();
        const parentWidth = Number(compound.width() || 0);
        const parentHeight = Number(compound.height() || 0);
        const nodeWidth = Number(node.width() || 40);
        const nodeHeight = Number(node.height() || 30);

        if (!parentWidth || !parentHeight) {
            return;
        }

        const outerPadding = 12;
        const reservedTopBand = Math.max(Math.floor(parentHeight * 0.24), 44);
        const minX = parentPos.x - parentWidth / 2 + nodeWidth / 2 + outerPadding;
        const maxX = parentPos.x + parentWidth / 2 - nodeWidth / 2 - outerPadding;
        const minY = parentPos.y - parentHeight / 2 + reservedTopBand + nodeHeight / 2;
        const maxY = parentPos.y + parentHeight / 2 - nodeHeight / 2 - outerPadding;

        const clamp = (value, minValue, maxValue) => {
            if (minValue > maxValue) {
                return (minValue + maxValue) / 2;
            }
            return Math.min(maxValue, Math.max(minValue, value));
        };

        node.position({
            x: clamp(nodePos.x, minX, maxX),
            y: clamp(nodePos.y, minY, maxY)
        });
    }


    const resizeStateByHandleId = new Map();

    cy.on('grab', 'node.choice-resize-handle', function (evt) {
        const handleNode = evt.target;
        const compoundId = String(handleNode.data('attachedTo') || '');
        const compoundNode = compoundId ? cy.$(`#${compoundId}`) : null;
        if (!compoundNode || compoundNode.length === 0) {
            return;
        }

        const compoundPos = compoundNode.position();
        resizeStateByHandleId.set(handleNode.id(), {
            compoundId,
            centerX: compoundPos.x,
            centerY: compoundPos.y
        });
    });

    cy.on('drag', 'node.choice-resize-handle', function (evt) {
        const handleNode = evt.target;
        const state = resizeStateByHandleId.get(handleNode.id());
        if (!state) {
            return;
        }

        const compoundNode = cy.$(`#${state.compoundId}`);
        if (!compoundNode || compoundNode.length === 0) {
            return;
        }

        const handlePos = handleNode.position();
        const handleSize = Number(handleNode.width() || 18);
        const handleOutset = (handleSize / 2) - 2;
        const candidateWidth = (handlePos.x - state.centerX - handleOutset) * 2;
        const candidateHeight = (handlePos.y - state.centerY - handleOutset) * 2;
        const minWidth = Number(WorkflowApp.CHOICE_MIN_WIDTH || 260);
        const minHeight = Number(WorkflowApp.CHOICE_MIN_HEIGHT || 180);
        const nextWidth = Math.max(minWidth, candidateWidth);
        const nextHeight = Math.max(minHeight, candidateHeight);

        compoundNode.style({
            'width': nextWidth,
            'height': nextHeight
        });

        syncChoiceHeader(compoundNode);
        syncChoiceResizeHandle(compoundNode);
    });

    cy.on('free', 'node.choice-resize-handle', function (evt) {
        resizeStateByHandleId.delete(evt.target.id());
    });

    // Keep detached header glued while the compound is moved.
    cy.on('position', 'node.choice-compound', function (evt) {
        syncChoiceAttachments(evt.target);
    });

    // Remove detached helpers when their compound is removed.
    cy.on('remove', 'node.choice-compound', function (evt) {
        const headerNode = cy.$(`#${evt.target.id()}_header`);
        if (headerNode && headerNode.length > 0) {
            cy.remove(headerNode);
        }

        const resizeNode = cy.$(`#${evt.target.id()}_resize`);
        if (resizeNode && resizeNode.length > 0) {
            cy.remove(resizeNode);
        }
    });

    Object.assign(WorkflowApp, {
        addChoiceCompoundToCanvas,
        getChoiceCompoundDimensions,
        syncChoiceResizeHandle,
        syncChoiceHeader,
        syncChoiceAttachments,
        addCustomNodeToCanvas,
        findChoiceCompoundForNodePosition,
        assignNodeToChoiceCompoundIfNeeded,
        moveNodeToChoiceSafeArea
    });

    // Connection drawing logic using Cytoscape events
})();
