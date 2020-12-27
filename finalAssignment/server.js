//#region Mongodb setting

const mongoClient = require('mongodb').MongoClient;
const objectId = require('mongodb').ObjectID;
const assert = require('assert');

const dbname = 'test';
const mongoUrl = `mongodb+srv://kitkit2431:kitkit1468@cluster0.tmvgs.mongodb.net/${dbname}?retryWrites=true&w=majority`;

//#endregion

//#region Express set up

const express = require('express');
const formidable = require('express-formidable');
const { callbackify } = require('util');
const { render } = require('ejs');
const cors = require('cors');
const { json } = require('express');
const app = express();
const fs = require('fs');
const trimSpaces = require('string-trim-spaces-only');
const session = require('cookie-session');
const bodyParser = require('body-parser');

//#endregion

//#region Other set up

app.set('view engine','ejs');
app.use(express.static("public"));
app.use(formidable());
app.use(cors());
const SECRETKEY = 'SessionKey';
app.use(session({
    name: 'cookieSession',
    keys: [SECRETKEY]
}));

//#endregion

//#region Restaurant function

const getRestaurantDocument = (criteria,cb)=>{
    const client = new mongoClient(mongoUrl);
    client.connect((err)=>{
        assert.equal(err,null);
        const db = client.db(dbname);
        let temp = db.collection('restaurants').find(criteria);
        temp.toArray((err,docs) => {
            client.close();
            assert.equal(err,null);
            cb(docs);
        });
    });
}

const insertRestaurantDocument = (doc,cb) => {
    const client = new mongoClient(mongoUrl);
    client.connect((err)=>{
        assert.equal(err,null);
        const db = client.db(dbname);
        db.collection('restaurants').insertOne(doc,(err,r) => {
            var acc = {};
            acc["username"]=doc.owner;
            var accdoc = {};
            accdoc["restaurants"] = {};
            accdoc["restaurants"]["_id"] = objectId(r.insertedId);
            accdoc["restaurants"]["restaurant_id"] = doc.restaurant_id;
            accdoc["restaurants"]["name"] = doc.name;
            db.collection('restaurant_user').updateOne(acc,{$push:accdoc},(err,r)=>{
                client.close();
                assert.equal(err,null);
                cb(r);
            });
        });
        
    });
}

const updateRestaurantDocument = (criteria,doc,cb) =>{
    const client = new mongoClient(mongoUrl);
    client.connect((err) => {
        assert.equal(err,null);
        const db = client.db(dbname);
        db.collection('restaurants').updateOne(criteria,{$set:doc},(err,r)=>{
            client.close();
            assert.equal(err,null);
            cb(r);
        });
    });
}

const pushRateDocument = (criteria,doc,acc,accdoc,cb)=>{
    const client = new mongoClient(mongoUrl);
    client.connect((err) => {
        assert.equal(err,null);
        const db = client.db(dbname);
        db.collection('restaurants').updateOne(criteria,{$push:doc},(err,r)=>{
            db.collection('restaurant_user').updateOne(acc,{$push:accdoc},(err,r)=>{
                client.close();
                assert.equal(err,null);
                cb(r);
            });
        });
    });
}

const deleteRestaurantDocument = (criteria,acc,cb) =>{
    const client = new mongoClient(mongoUrl);
    client.connect((err) => {
        assert.equal(err,null);
        const db = client.db(dbname);
        let res = {};
        res["restaurants"] = {};
        res["restaurants"]["_id"] = objectId(criteria._id);
        getRestaurantDocument(criteria,(doc)=>{
            if(doc[0].grades.length > 0){
                let gra = {};
                gra["grading"] = {};
                gra["grading"]["_id"] = objectId(criteria._id);
                let c = {"grading":{$elemMatch:{"_id" : objectId(criteria._id)}}};
                pullUserRate(c,gra,(err)=>{
                    db.collection('restaurants').deleteMany(criteria,(err,results)=>{
                        db.collection('restaurant_user').updateOne(acc,{$pull:res},(err,r)=>{
                            client.close();
                            assert.equal(err,null);
                            cb(r);
                        });
                    });
                });
            } else{
                db.collection('restaurants').deleteMany(criteria,(err,results)=>{
                    db.collection('restaurant_user').updateOne(acc,{$pull:res},(err,r)=>{
                        client.close();
                        assert.equal(err,null);
                        cb(r);
                    });
                });
            }
        });
    });
}
    
const handle_Find = (res,criteria)=>{
    //create search query
    var temp = {};
    if(criteria.search != null && criteria.search != ""){
        let c = trimSpaces(criteria.search).res;
        switch(criteria.type){
            case "name":
                temp = {"name":new RegExp(c)};
                break;
            case "borough":
                temp = {"borough":new RegExp(c)};
                break;
            case "cuisine":
                temp = {"cuisine":new RegExp(c)};
                break;
            default:
                temp = {$or:[{"restaurant_id":new RegExp(c)},{"name":new RegExp(c)},{"borough":new RegExp(c)},{"cuisine":new RegExp(c)}]};
                break;
        }
    }
    //console.log(JSON.stringify(temp));

    //get docs
    getRestaurantDocument(temp,(docs)=>{
        res.status(200).render('search',{arrayLength:docs.length,restaurants:docs});
    });
};

const handle_Detail = (res,criteria,reqType,req) => {
    criteria['_id']=objectId(criteria._id);
    getRestaurantDocument(criteria,(docs)=>{
        if(reqType == 'edit'){
            let userid = req.session.userid;
            if(docs[0].owner == userid){
                res.status(200).render('edit',{restaurant:docs[0]});
            }else{
                res.status(502).redirect('/*');
            }
        } else {
            res.status(200).render('detail',{restaurant:docs[0],"userid":req.session.userid,"username":req.session.username});
        }
    });
}

const handle_Create = (res,doc) => {
    var temp = {};
    let address = {};
    temp["restaurant_id"] = doc.fields.restaurantId;
    getRestaurantDocument(temp,(result)=>{
        if(result.length > 0){
            //console.log("Alreadly has a same id");
            doc.session.create = 0;
            res.status(200).redirect('/userdetail');
        } else {
            temp["name"] = doc.fields.name;
            temp["owner"] = doc.session.userid;
            temp["ownername"] = doc.session.username;
            temp["borough"] = doc.fields.borough;
            temp["cuisine"] = doc.fields.cuisine;
            address["building"] = doc.fields.building;
            address["coord"] = [doc.fields.lon,doc.fields.lat];
            address["street"] = doc.fields.street;
            address["zipcode"] = doc.fields.zipcode;
            temp["address"] = address;
            temp["grades"] = [];
            if(doc.files.photoUpload.size > 0){
                fs.readFile(doc.files.photoUpload.path,(err,data) => {
                    assert.equal(err,null);
                    temp["photo"] = new Buffer.from(data).toString('base64');
                    insertRestaurantDocument(temp,(r)=>{
                        doc.session.create = 1;
                        res.status(200).redirect('/userdetail');
                    });
                });
            }else{
                insertRestaurantDocument(temp,(r)=>{
                    doc.session.create = 1;
                    res.status(200).redirect('/userdetail');
                });
            }
        }
    });
}

const handle_Update = (res,updates) =>{
    var id = {};
    id['_id'] = objectId(updates.fields._id);
    var doc = {};
    var address = {};
    //console.log(id);
    doc["name"] = updates.fields.name;
    doc["borough"] = updates.fields.borough;
    doc["cuisine"] = updates.fields.cuisine;
    address["building"] = updates.fields.building;
    address["coord"] = [updates.fields.lon,updates.fields.lat];
    address["street"] = updates.fields.street;
    address["zipcode"] = updates.fields.zipcode;
    doc["address"] = address;
    if(updates.fields.removePhoto == 'on'){
        doc["photo"] = null;
    }
    if(updates.files.photoUpload != null){
        if(updates.files.photoUpload.size > 0){
            fs.readFile(updates.files.photoUpload.path,(err,data) => {
                assert.equal(err,null);
                doc["photo"] = new Buffer.from(data).toString('base64');
                updateRestaurantDocument(id,doc,(result)=>{
                    res.status(200).redirect('/detail?_id='+updates.fields._id);
                });
            });
        } else {
            updateRestaurantDocument(id,doc,(result)=>{
                res.status(200).redirect('/detail?_id='+updates.fields._id);
            });
        }
    }else{
        updateRestaurantDocument(id,doc,(result)=>{
            res.status(200).redirect('/detail?_id='+updates.fields._id);
        });
    }
    //console.log(doc);
}

const handle_Delete = (res,docId) =>{
    let doc = {};
    let owner = {};
    owner["username"]=docId.session.userid;
    doc["_id"] = objectId(docId.fields._id);
    getRestaurantDocument(doc,(docs)=>{
        let username = docId.session.userid;
        if(docs[0].owner == username){
            deleteRestaurantDocument(doc,owner,(result)=>{
                docId.session.delete = 1;
                res.status(200).redirect('/userdetail');
            });
        }else{
            res.status(502).redirect('/*');
        }
    });
}

const handle_Rating = (res,rating) => {
    var date = new Date();
    let doc = {};
    let grades ={};
    let acc = {};
    let accdoc = {};
    doc["_id"] = objectId(rating.fields._id);
    grades["grades"] = {};
    grades["grades"]["username"] = rating.session.userid;
    grades["grades"]["name"] = rating.session.username;
    grades["grades"]["date"] = date;
    grades["grades"]["score"] = rating.fields.rate;
    acc["username"] = rating.session.userid;
    accdoc["grading"] = {};
    accdoc["grading"]["_id"] = objectId(rating.fields._id);
    accdoc["grading"]["name"] = rating.fields.name;
    accdoc["grading"]["date"] = date;
    accdoc["grading"]["score"] = rating.fields.rate;
    pushRateDocument(doc,grades,acc,accdoc,(result)=>{
        res.status(200).redirect('/detail?_id='+rating.fields._id);
    });
}

//#endregion

//#region User function

const getUserDocument = (criteria,cb)=>{
    const client = new mongoClient(mongoUrl);
    client.connect((err)=>{
        assert.equal(err,null);
        const db = client.db(dbname);
        let temp = db.collection('restaurant_user').find(criteria);
        temp.toArray((err,docs) => {
            client.close();
            assert.equal(err,null);
            cb(docs);
        });
    });
}

const insertUserDocument = (doc,cb) => {
    const client = new mongoClient(mongoUrl);
    client.connect((err)=>{
        assert.equal(err,null);
        const db = client.db(dbname);
        db.collection('restaurant_user').insertOne(doc,(err,r) => {
            client.close();
            assert.equal(err,null);
            cb(r);
        });
        
    });
}

const updateUserDocument = (criteria,doc,cb) =>{
    const client = new mongoClient(mongoUrl);
    client.connect((err) => {
        assert.equal(err,null);
        const db = client.db(dbname);
        db.collection('restaurant_user').updateOne(criteria,{$set:doc},(err,r)=>{
            client.close();
            assert.equal(err,null);
            cb(r);
        });
    });
}

const pullUserRate = (criteria,doc,cb) =>{
    const client = new mongoClient(mongoUrl);
    client.connect((err) => {
        assert.equal(err,null);
        const db = client.db(dbname);
        db.collection('restaurant_user').updateMany(criteria,{$pull:doc},(err,r)=>{
            client.close();
            assert.equal(err,null);
            cb(r);
        });
    });
}

const handle_Login = (res,account) =>{
    var acc = {};
    acc["username"] = account.fields.username;
    acc["password"] = account.fields.password;
    getUserDocument(acc,(result)=>{
        if(result.length != 1){
            account.session.userid = null;
            account.session.login = 0;
            res.status(200).redirect('/');
        } else {
            account.session.userid = result[0].username;
            account.session.password = result[0].password;
            account.session.username = result[0].name;
            account.session.login = 1;
            res.status(200).redirect('/');
        }
    });
}

const handle_SignUp = (res,account) => {
    var acc = {};
    acc["username"]=account.fields.username;
    getUserDocument(acc,(result)=>{
        if(result.length > 0){
            account.session.state = 0;
            res.status(200).redirect('/signuppage');
        } else {
            acc["password"]=account.fields.password;
            acc["name"]=account.fields.name;
            acc["restaurants"]=[];
            acc["grading"]=[];
            insertUserDocument(acc,(result)=>{
                account.session.state = 1;
                res.status(200).redirect('/');
            });
        }
    });
    
}

const handle_userDetail = (res,account) =>{
    var acc = {};
    acc["username"] = account.session.userid;
    getUserDocument(acc,(result)=>{
        let value = {};
        value['c'] = account.session.create;
        value['d'] = account.session.delete;
        value['userid'] = account.session.userid;
        account.session.delete = -1;
        account.session.create = -1;
        res.status(200).render('userdetail',{account:result[0],"value":value});
    });
}

//#endregion

//#region Server structure

//#region Handle restaurant page render

app.get('/', (req,res)=>{
    let value = {};
    value['c'] = req.session.create;
    value['userid'] = req.session.userid;
    value['username'] = req.session.username;
    value['login'] = req.session.login;
    value['state'] = req.session.state;
    req.session.create = -1;
    req.session.state = -1;
    req.session.login = -1;
    res.status(200).render('index',{"value":value});
});

app.get('/search',(req,res)=>{
    handle_Find(res,req.query);
});

app.get('/detail',(req,res)=>{

    handle_Detail(res,req.query,'detail',req);
})

app.get('/create',(req,res)=>{
    if(req.session.userid != null){
        res.status(200).render('create');
    } else {
        res.status(502).redirect('/*');
    }
});

app.get('/edit',(req,res)=>{
    if(req.session.userid != null){
        handle_Detail(res,req.query,'edit',req);
    } else {
        res.status(502).redirect('/*');
    }
});

app.get('/coord',(req,res)=>{
    res.status(200).render('coord',{"lat":req.query.lat,"lon":req.query.lon});
});

//#endregion

//#region Handle restaurant CUD

app.post('/insert',(req,res)=>{
    handle_Create(res,req);
    //res.send("POST Request Called");
});

app.post('/delete',(req,res)=>{
    if(req.session.userid != null){
        handle_Delete(res,req);
    } else {
        res.status(500).redirect('/*');
    }
});

app.post('/update',(req,res)=>{
    handle_Update(res,req);
});

app.post('/rate',(req,res)=>{
    if(req.session.userid != null){
        handle_Rating(res,req);
    } else {
        res.status(500).redirect('/*');
    }
});

//#endregion

//#region Handle user page render

app.get('/signuppage',(req,res) => {
    var state = req.session.state;
    req.session.state = -1;
    res.status(200).render('signup',{"state":state});
});

app.get('/logout',(req,res)=>{
    req.session.userid = null;
    req.session.password = null;
    req.session.username = null;
    res.status(200).redirect('/');
});

app.get('/userdetail',(req,res)=>{
    handle_userDetail(res,req);
});

//#endregion

//#region Handle user CUD

app.post('/login',(req,res)=>{
    handle_Login(res,req);
});

app.post('/signup',(req,res)=>{
    handle_SignUp(res,req);
});

//#endregion

//#region Handle RESTful api

app.get('/api/restaurant/name/:name',(req,res) =>{
    if(req.params.name){
        //console.log(req.params.name);
        //console.log(req.params);
        getRestaurantDocument(req.params,(docs) => {
            res.status(200).json(docs);
        });
    } else {
        res.status(500).json("Error : missing restaurant name");
    }
});

app.get('/api/restaurant/borough/:borough',(req,res) =>{
    if(req.params.borough){
        //console.log(req.params.name);
        //console.log(req.params);
        getRestaurantDocument(req.params,(docs) => {
            res.status(200).json(docs);
        });
    } else {
        res.status(500).json("Error : missing restaurant borough");
    }
});

app.get('/api/restaurant/cuisine/:cuisine',(req,res) =>{
    if(req.params.cuisine){
        //console.log(req.params.name);
        //console.log(req.params);
        getRestaurantDocument(req.params,(docs) => {
            res.status(200).json(docs);
        });
    } else {
        res.status(500).json("Error : missing restaurant cuisine");
    }
});

//#endregion

//handle unwanted request

app.get('/*',(req,res)=>{
    res.status(404).render('error');
});

app.listen(app.listen(process.env.PORT || 8099));