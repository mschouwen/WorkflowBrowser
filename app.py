from flask import Flask, render_template, Response, request, jsonify
from flask_restful import Api, Resource
import ilwis
import json
import os
import pathlib
import uuid

workflow_id = -1

def get_metadata(operation_name):
    id = ilwis.operationMetaData(operation_name,  'id',workflow_id, '')
    metadata = ilwis.operationMetaData(id)
        
    # Parse metadata string: key/value pairs separated by '@'
    metadata_dict = {}
    if metadata:
        try:
            metadata_dict = json.loads(metadata)
        except json.JSONDecodeError:
            print(f"Error: Could not parse metadata as JSON: {metadata}")
    return metadata_dict

def get_icon(datatype): 
    icons = {
        'numericdomain': 'numericdomain.png',
        'textdomain': 'textdomain.png',
        'rastercoverage': 'raster.png',
        'vector': 'vector.png',
        'table': 'table.png',
        'georeferece': 'georeference.png',
        'coordinatesystem': 'coordinatesystem.png',
        'string': 'text.png',
        'int64' : 'numbers20.png',
        'unknown': 'choice.png',
        'itemdomain': 'itemdomain.png',
        'operation': 'operation.png',
        'ellipsoid': 'ellipsoid.png',
        'projection': 'projection.png',
        'point' : 'vector_point.png',
        'line' : 'vector_line.png',
        'polygon' : 'vector_fill.png',
        'colordomain' : 'colordom.png',
        'text' : 'text.png',
        'bool' : 'bool20.png'
    }
    
    # If datatype contains pipe-separated types, return a list of icons (filtering out '?')
    if '|' in datatype:
        types = []
        for t in datatype.split('|'):      
            if t.strip() and t.strip() != '?':
               if t.strip() in icons:
                types.append(t.strip())
        #types = [t.strip() for t in datatype.split('|') if t.strip() and t.strip() != '?']
        if not types:  # If all types were '?', return None
            return None
        return [icons.get(t, icons['unknown']) for t in types]
    
    # If single type is '?', return None
    if datatype == '?':
        return None
    
    # Otherwise return a single icon string
    return icons.get(datatype, icons['unknown'])

                
app = Flask(__name__, template_folder='.', static_folder='.', static_url_path='')
app.secret_key = 'your-secret-key-change-this'  # Change this to a secure secret key

api = Api(app)

# Global dictionary to couple session_id with workflow_id


@app.route('/')
def index():
    return render_template('index.html')

class DataResource(Resource):
    def get(self):
       html = render_template('index.html')
       return Response(html, mimetype='text/html')

api.add_resource(DataResource, '/api/data')

@app.route('/api/sidebar', methods=['GET'])
def get_sidebar_items():
    """Endpoint to return sidebar items"""
    items = ilwis.operations()
   # n = ilwis.operationMetaData(items[1],'id',-1,'')
   # p = ilwis.operationMetaData(n)
    return jsonify({'items': items})

@app.route('/api/workflow-id', methods=['GET'])
def get_workflow_id():
    global workflow_id
    
    if workflow_id == -1:
        resp = ilwis.updateWorkflow('{"workflow_id" : -1}','create')
        metadata_dict = json.loads(resp)
        workflow_id = metadata_dict.get('workflow_id', -1)

    return jsonify({'workflow_id': workflow_id})
                    

@app.route('/api/node-table', methods=['POST'])
def generate_node_table():
    """Generate HTML table for a node"""
    data = request.get_json()
    node_data = data.get('node', {})
    
    if node_data.get('type') == 'operation':
        html = f"""<table class="node-table">
                <tr class="header"><td colspan="2">{node_data.get('name', 'Unknown')}</td></tr>
                <tr><td>CPU</td><td>{node_data.get('cpu', 'N/A')}</td></tr>
                <tr><td>RAM</td><td>{node_data.get('ram', 'N/A')}</td></tr>
            </table>"""
        return jsonify({'html': html.strip()})
    
    return jsonify({'html': ''})


@app.route('/api/drop', methods=['POST'])
def handle_drop():
    data = request.get_json()
    item = data.get('item')
    md = get_metadata(item)
    position = data.get('position')
    
    print(f"Dropped item: {item} at position {position}")
    
    # Use operation ID as initial node ID - unique ID will be assigned by updateWorkflow
    node_id = md['id']
    # Create node data to add to the graph
    node_data = {
        'id': node_id,
        'operation_id': md['id'],
        'name': md.get('name', item),
        'description': md.get('desc', 'No description available'),
        'type': 'operation',
        'x': position['x'],
        'y': position['y'],
        'parameters': md.get('parameters', {})  # Include parameters in node data
    }
    
    # Generate table HTML on server
    table_rows = f'<tr class="header"><td colspan="3">{node_data["name"]}</td></tr>'
    
    # Add parameter rows from metadata
    if 'parameters' in md and isinstance(md['parameters'], dict):
        for param_key, param_value in md['parameters'].items():
            if isinstance(param_value, dict) and 'UIname' in param_value:
                ui_name = param_value['UIname']
                index = param_value.get('index', '')
                param_type = param_value.get('type', '?')
                icon = get_icon(param_type)
                
                # Create icon HTML - handle both single icon string and list of icons
                if icon is None:
                    icon_html = ''
                elif isinstance(icon, list):
                    icon_html = ''.join([f'<img src="/images/{ic}" style="width: 16px; height: 16px; margin-right: 2px;" />' for ic in icon])
                else:
                    icon_html = f'<img src="/images/{icon}" style="width: 16px; height: 16px;" />'
                       
                table_rows += f'\n                <tr><td>{index}</td><td>{icon_html}</td><td>{ui_name}</td></tr>'
    
    table_html = f"""<table class="node-table">
                {table_rows}
            </table>"""
    
    node_data['tableHtml'] = table_html
    
    response = {
        'status': 'success',
        'message': f'Node "{item}" added at position ({position["x"]}, {position["y"]})',
        'node': node_data
    }
    
    return jsonify(response)

@app.route('/api/graph', methods=['POST'])
def handle_graph_update():
    """Handle graph state updates from the client"""
    try:
        graph_data = request.get_data(as_text=True)
        
        print(f"Graph update received:")
        print(f"  Graph data (string): {graph_data}")
        
        # Parse the string to validate and get counts
        parsed_graph = json.loads(graph_data)
        print(f"  Nodes: {len(parsed_graph.get('mnodes', []))} node(s)")
        print(f"  Connections: {len(parsed_graph.get('connections', []))} connection(s)")
        
        p = ilwis.updateWorkflow(graph_data)
        parsed_response = json.loads(p)
        
        response = {
            'status': 'success',
            'message': 'Graph state updated on server',
            'nodes_count': len(parsed_graph.get('mnodes', [])),
            'connections_count': len(parsed_graph.get('connections', [])),
            'workflow_id': parsed_response.get('workflow_id', -1),
            'nodeid': parsed_response.get('nodeid', None)
        }
        
        return jsonify(response)
    except Exception as e:
        print(f"Error processing graph update: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 400

if __name__ == '__main__':
    app.run(debug=True, host='localhost', port=5000)
